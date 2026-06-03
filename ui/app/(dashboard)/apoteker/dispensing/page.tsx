"use client";

import {
	CalendarDays,
	Check,
	CheckCircle2,
	ClipboardList,
	Clock3,
	Ban,
	FilePlus2,
	FileText,
	Filter,
	History,
	Pencil,
	ListFilter,
	Loader2,
	Printer,
	PackageCheck,
	Plus,
	RotateCcw,
	Search,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SuggestionPanel } from "@/components/apoteker/suggestion-panel";
import {
	computeDispensingStatistics,
	filterDispensingOrders,
	getPeriodSummaryLabel,
	getQueueViewLabel,
	groupDispensingOrdersByPrescription,
	hasActiveDashboardFilters,
	inferOrderServiceType,
	type DispensingPeriodFilter,
	type DispensingPrescriptionQueueGroup,
	type DispensingQueueView,
	type DispensingServiceFilter,
	type DispensingStatusFilter,
} from "@/lib/apoteker/dispensing-dashboard-filters";
import {
	dedupeMedicineSuggestions,
	filterDosageSuggestions,
	findBestMedicineMatch,
	inferDefaultDosage,
	mapStockItemToMedicineSuggestion,
	normalizeFieldSearch,
	stockStatusLabel,
	type MedicineSuggestion,
} from "@/lib/apoteker/prescription-form-helpers";
import {
	APOTEKER_AUTO_REFRESH_INTERVAL_MS,
	isApotekerAutoRefreshEnabled,
} from "@/lib/apoteker/apoteker-runtime-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogScrollBody,
	DialogTitle,
	dialogTallLayoutClassName,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DispensingWorkflowTransitionStatus } from "@/lib/demo/dispensing-workflow";
import type {
	DemoDispensingOrder,
	DemoDispensingWorkflowStatus,
	DemoLabelPreview,
	DemoPatientPaymentSummary,
	DemoStockItem,
} from "@/lib/demo/types";

interface DispensingResponse {
	orders: DemoDispensingOrder[];
}

interface DispensingLookupItem {
	nomorObat: string;
	medicineName: string;
	dosage: string;
	quantity: number;
	keteranganObat: string;
}

interface DispensingLookupPrescription {
	nomorRM: string;
	nomorPeresepan: string;
	patientName: string;
	doctorName: string;
	items: DispensingLookupItem[];
}

interface DispensingLookupResponse {
	prescription: DispensingLookupPrescription;
}

interface DispensingPatientOption {
	userId: string;
	name: string;
	email: string;
	nomorRM?: string;
}

interface DispensingPatientOptionResponse {
	patients: DispensingPatientOption[];
}

interface DispensingResetResponse {
	reset: {
		deletedOrders: number;
		deletedPrescriptions: number;
		deletedPayments: number;
		deletedPatients: number;
		deletedTransactions: number;
	};
}

interface LabelPreviewResponse {
	label?: DemoLabelPreview;
	error?: string;
}

interface MedicationItem {
	id: string;
	nomorObat: string;
	medicineName: string;
	dosage: string;
	quantity: number;
}

type ManualEntryMode = "from_prescription" | "manual_prescription";

interface PrescriptionCatalogResponse {
	prescriptions: DemoPatientPaymentSummary[];
}

interface StockSearchResponse {
	items: DemoStockItem[];
}

const EDIT_MEDICINE_SUGGESTION_ID = "__edit_order_medicine__";

const cardSurfaceClass =
	"border-emerald-200/80 bg-white shadow-sm shadow-emerald-950/5 dark:border-emerald-900/50 dark:bg-emerald-950/10";
const softPanelClass =
	"rounded-lg border border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/25";
const primaryActionClass =
	"bg-emerald-600 text-white shadow-sm shadow-emerald-900/20 hover:bg-emerald-700 focus-visible:ring-emerald-500/40";
const secondaryActionClass =
	"border-emerald-300 bg-emerald-50/70 text-emerald-800 hover:border-emerald-400 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100 dark:hover:bg-emerald-950/50";
const quietInputClass =
	"border-emerald-200 bg-emerald-50/20 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/25 dark:border-emerald-900/70 dark:bg-emerald-950/10";

function resolveWorkflowStatus(
	order: DemoDispensingOrder,
): DemoDispensingWorkflowStatus {
	if (
		order.workflowStatus === "menunggu_validasi_resep" ||
		order.workflowStatus === "menunggu_pembayaran" ||
		order.workflowStatus === "siap_diracik" ||
		order.workflowStatus === "sedang_diracik" ||
		order.workflowStatus === "siap_diserahkan" ||
		order.workflowStatus === "diserahkan" ||
		order.workflowStatus === "cancel"
	) {
		return order.workflowStatus;
	}

	if (order.status === "selesai") {
		return "diserahkan";
	}

	if (order.status === "siap_diserahkan") {
		return "siap_diserahkan";
	}

	if (order.status === "diracik") {
		return "sedang_diracik";
	}

	return (order.paymentStatus ?? "menunggu_bayar") === "lunas"
		? "siap_diracik"
		: "menunggu_pembayaran";
}

function statusBadge(workflowStatus: DemoDispensingWorkflowStatus): {
	text: string;
	className: string;
} {
	if (workflowStatus === "diserahkan") {
		return {
			text: "Diserahkan",
			className:
				"border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
		};
	}

	if (workflowStatus === "siap_diserahkan") {
		return {
			text: "Siap Diserahkan",
			className:
				"border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
		};
	}

	if (workflowStatus === "sedang_diracik") {
		return {
			text: "Diracik",
			className:
				"border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
		};
	}

	if (workflowStatus === "siap_diracik") {
		return {
			text: "Siap Diracik",
			className:
				"border-teal-200 bg-teal-100 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200",
		};
	}

	if (workflowStatus === "cancel") {
		return {
			text: "Dibatalkan",
			className:
				"border-rose-200 bg-rose-100 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200",
		};
	}

	return {
		text: "Menunggu Pembayaran",
		className:
			"border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200",
	};
}

function paymentStatusBadge(
	paymentStatus: DemoDispensingOrder["paymentStatus"],
): {
	text: string;
	className: string;
} {
	if (paymentStatus === "lunas") {
		return {
			text: "Lunas",
			className:
				"border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
		};
	}

	if (paymentStatus === "gagal") {
		return {
			text: "Gagal",
			className:
				"border-rose-200 bg-rose-100 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200",
		};
	}

	if (paymentStatus === "dibatalkan") {
		return {
			text: "Dibatalkan",
			className:
				"border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200",
		};
	}

	if (paymentStatus === "refund") {
		return {
			text: "Refund",
			className:
				"border-violet-200 bg-violet-100 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200",
		};
	}

	return {
		text: "Menunggu Pembayaran",
		className:
			"border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
	};
}

function getNextWorkflowAction(
	workflowStatus: DemoDispensingWorkflowStatus,
): { label: string; target: DispensingWorkflowTransitionStatus } | null {
	if (workflowStatus === "diserahkan" || workflowStatus === "cancel") {
		return null;
	}

	if (workflowStatus === "siap_diserahkan") {
		return {
			label: "Konfirmasi Diserahkan",
			target: "diserahkan",
		};
	}

	if (workflowStatus === "sedang_diracik") {
		return {
			label: "Set Siap Diserahkan",
			target: "siap_diserahkan",
		};
	}

	return {
		label: "Konfirmasi Diracik",
		target: "sedang_diracik",
	};
}

function getGroupPaymentStatus(
	groupOrders: DemoDispensingOrder[],
): NonNullable<DemoDispensingOrder["paymentStatus"]> {
	const statuses = groupOrders.map(
		(order) => order.paymentStatus ?? "menunggu_bayar",
	);

	if (statuses.every((status) => status === "lunas")) {
		return "lunas";
	}

	if (statuses.some((status) => status === "refund")) {
		return "refund";
	}

	if (statuses.some((status) => status === "dibatalkan")) {
		return "dibatalkan";
	}

	if (statuses.some((status) => status === "gagal")) {
		return "gagal";
	}

	return "menunggu_bayar";
}

type GroupWorkflowSummary =
	| {
			type: "single";
			status: DemoDispensingWorkflowStatus;
			nextAction: ReturnType<typeof getNextWorkflowAction>;
	  }
	| {
			type: "mixed";
			statuses: DemoDispensingWorkflowStatus[];
	  }
	| {
			type: "complete";
	  };

function getGroupWorkflowSummary(
	groupOrders: DemoDispensingOrder[],
): GroupWorkflowSummary {
	const activeOrders = groupOrders.filter((order) => {
		const status = resolveWorkflowStatus(order);
		return status !== "diserahkan" && status !== "cancel";
	});

	if (activeOrders.length === 0) {
		return { type: "complete" };
	}

	const statuses = [
		...new Set(activeOrders.map((order) => resolveWorkflowStatus(order))),
	];

	if (statuses.length === 1) {
		const status = statuses[0]!;
		return {
			type: "single",
			status,
			nextAction: getNextWorkflowAction(status),
		};
	}

	return { type: "mixed", statuses };
}

function normalizeSearchText(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, " ");
}

async function readApiJsonPayload<T extends { error?: string }>(
	response: Response,
	fallbackError: string,
): Promise<T> {
	const rawBody = await response.text();
	if (!rawBody.trim()) {
		if (!response.ok) {
			throw new Error(fallbackError);
		}
		return {} as T;
	}

	try {
		return JSON.parse(rawBody) as T;
	} catch {
		throw new Error(
			response.ok
				? "Respons server tidak valid."
				: fallbackError,
		);
	}
}

function escapeLabelText(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function formatLabelDurationFromQuantity(quantity: number): string {
	const normalized = Number.isFinite(quantity)
		? Math.max(1, Math.round(quantity))
		: 1;
	if (normalized === 1) {
		return "1 unit pemakaian";
	}

	return `${normalized} unit pemakaian`;
}

export default function DispensingPage() {
	const [orders, setOrders] = useState<DemoDispensingOrder[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isLookupLoading, setIsLookupLoading] = useState(false);
	const [isManualLookupLoading, setIsManualLookupLoading] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isManualSubmitting, setIsManualSubmitting] = useState(false);
	const [isUpdatingWorkflow, setIsUpdatingWorkflow] = useState(false);
	const [_isPatientOptionsLoading, setIsPatientOptionsLoading] = useState(true);
	const [isResettingData, setIsResettingData] = useState(false);
	const [isGeneratingLabel, setIsGeneratingLabel] = useState(false);
	const [processingNomorObat, setProcessingNomorObat] = useState<string | null>(
		null,
	);
	const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
	const [labelOrderId, setLabelOrderId] = useState<string | null>(null);
	const [errorMessage, setErrorMessage] = useState("");
	const [successMessage, setSuccessMessage] = useState("");

	// Auto-dismiss messages
	useEffect(() => {
		if (successMessage) {
			if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
			successTimeoutRef.current = setTimeout(() => {
				setSuccessMessage("");
			}, 5000);
		}
		return () => {
			if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
		};
	}, [successMessage]);

	useEffect(() => {
		if (errorMessage) {
			if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
			errorTimeoutRef.current = setTimeout(() => {
				setErrorMessage("");
			}, 8000);
		}
		return () => {
			if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
		};
	}, [errorMessage]);
	const [labelPreview, setLabelPreview] = useState<DemoLabelPreview | null>(
		null,
	);
	const [_labelPreviewOrder, setLabelPreviewOrder] = useState<{
		id: string;
		nomorRM?: string;
		nomorPeresepan?: string;
		patientName: string;
		medicineName: string;
		dosage: string;
	} | null>(null);
	const [isHistoryDetailOpen, setIsHistoryDetailOpen] = useState(false);
	const [isEditResepOpen, setIsEditResepOpen] = useState(false);
	const [selectedHistoryOrder, setSelectedHistoryOrder] =
		useState<DemoDispensingOrder | null>(null);
	const [editNomorObat, setEditNomorObat] = useState("");
	const [editMedicineName, setEditMedicineName] = useState("");
	const [editDosage, setEditDosage] = useState("");
	const [editQuantity, setEditQuantity] = useState("1");
	const [cancelReason, setCancelReason] = useState("");
	const [isSavingOrderDetails, setIsSavingOrderDetails] = useState(false);
	const [isCancelingOrder, setIsCancelingOrder] = useState(false);
	const [updatingGroupKey, setUpdatingGroupKey] = useState<string | null>(null);
	const [patientOptions, setPatientOptions] = useState<
		DispensingPatientOption[]
	>([]);
	const [orderListQuery, setOrderListQuery] = useState("");
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const manualNomorRMRef = useRef<HTMLInputElement>(null);
	const nomorRMRef = useRef<HTMLInputElement>(null);
	const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	// Filter states
	const [filterTipeLayanan, setFilterTipeLayanan] = useState("Semua");
	const [filterStatusPeracikan, setFilterStatusPeracikan] = useState("Semua");
	const [filterTanggal, setFilterTanggal] = useState("Hari ini");
	const [queueView, setQueueView] = useState<DispensingQueueView>("antrean");

	const [nomorRM, setNomorRM] = useState("");
	const [nomorPeresepan, setNomorPeresepan] = useState("");
	const [lookupPrescription, setLookupPrescription] =
		useState<DispensingLookupPrescription | null>(null);
	const [manualPatientUserId, setManualPatientUserId] = useState("");
	const [manualPatientName, setManualPatientName] = useState("");
	const [manualNomorRM, setManualNomorRM] = useState("");
	const [manualNomorPeresepan, setManualNomorPeresepan] = useState("");
	const [manualDoctorName, setManualDoctorName] = useState("");
	const [manualLookupPrescription, setManualLookupPrescription] =
		useState<DispensingLookupPrescription | null>(null);
	const [manualEntryMode, setManualEntryMode] =
		useState<ManualEntryMode>("from_prescription");

	// New state for dynamic medication array
	const [obatList, setObatList] = useState<MedicationItem[]>([
		{ id: "med-1", nomorObat: "", medicineName: "", dosage: "", quantity: 1 },
	]);
	const [medicineSuggestionsByObatId, setMedicineSuggestionsByObatId] =
		useState<Record<string, MedicineSuggestion[]>>({});
	const [medicineSuggestionLoadingId, setMedicineSuggestionLoadingId] =
		useState<string | null>(null);
	const [activeMedicineObatId, setActiveMedicineObatId] = useState<string | null>(
		null,
	);
	const [highlightedMedicineIdx, setHighlightedMedicineIdx] = useState(0);
	const [highlightedEditMedicineIdx, setHighlightedEditMedicineIdx] = useState(0);
	const [showPatientSuggestions, setShowPatientSuggestions] = useState(false);
	const [showPrescriptionSuggestions, setShowPrescriptionSuggestions] =
		useState(false);
	const [highlightedPatientIdx, setHighlightedPatientIdx] = useState(0);
	const [highlightedPrescriptionIdx, setHighlightedPrescriptionIdx] =
		useState(0);
	const [prescriptionCatalog, setPrescriptionCatalog] = useState<
		DemoPatientPaymentSummary[]
	>([]);
	const [isPrescriptionCatalogLoading, setIsPrescriptionCatalogLoading] =
		useState(false);
	const medicineSearchTimersRef = useRef<
		Record<string, ReturnType<typeof setTimeout>>
	>({});
	const kelolaDialogScrollRef = useRef<HTMLDivElement>(null);

	// Legacy state for compatibility with from_prescription mode
	const [_manualNomorObat, setManualNomorObat] = useState("");
	const [_manualMedicineName, setManualMedicineName] = useState("");
	const [_manualDosage, setManualDosage] = useState("");
	const [_manualQuantity, setManualQuantity] = useState("1");
	const [_manualSelectedNomorObat, setManualSelectedNomorObat] = useState("");

	const dashboardFilters = useMemo(
		() => ({
			searchQuery: orderListQuery,
			period: filterTanggal as DispensingPeriodFilter,
			statusPeracikan: filterStatusPeracikan as DispensingStatusFilter,
			tipeLayanan: filterTipeLayanan as DispensingServiceFilter,
			queueView,
		}),
		[
			orderListQuery,
			filterTanggal,
			filterStatusPeracikan,
			filterTipeLayanan,
			queueView,
		],
	);

	const periodSummaryLabel = getPeriodSummaryLabel(dashboardFilters.period);

	const statistics = useMemo(
		() =>
			computeDispensingStatistics(
				filterDispensingOrders(
					orders,
					{
						...dashboardFilters,
						searchQuery: "",
						statusPeracikan: "Semua",
						tipeLayanan: "Semua",
						queueView: "semua",
					},
					resolveWorkflowStatus,
					normalizeSearchText,
				),
				resolveWorkflowStatus,
			),
		[orders, dashboardFilters],
	);

	const filteredOrders = useMemo(
		() =>
			filterDispensingOrders(
				orders,
				dashboardFilters,
				resolveWorkflowStatus,
				normalizeSearchText,
			),
		[orders, dashboardFilters],
	);

	const filteredPrescriptionGroups = useMemo(
		() => groupDispensingOrdersByPrescription(filteredOrders),
		[filteredOrders],
	);

	const isDashboardFilterActive = hasActiveDashboardFilters(dashboardFilters);

	const historyOrdersCount = useMemo(
		() =>
			filterDispensingOrders(
				orders,
				{
					...dashboardFilters,
					searchQuery: "",
					statusPeracikan: "Semua",
					tipeLayanan: "Semua",
					queueView: "riwayat",
				},
				resolveWorkflowStatus,
				normalizeSearchText,
			).length,
		[orders, dashboardFilters],
	);

	const relatedPrescriptionOrders = useMemo(() => {
		if (!selectedHistoryOrder?.nomorPeresepan) {
			return [];
		}

		const target = selectedHistoryOrder.nomorPeresepan.toUpperCase();
		return orders
			.filter(
				(order) => (order.nomorPeresepan ?? "").toUpperCase() === target,
			)
			.sort(
				(a, b) =>
					new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
			);
	}, [orders, selectedHistoryOrder]);

	useEffect(() => {
		if (!isHistoryDetailOpen) {
			return;
		}

		setSelectedHistoryOrder((current) => {
			if (!current) {
				return current;
			}

			const refreshed = orders.find((order) => order.id === current.id);
			if (!refreshed) {
				return current;
			}

			if (
				resolveWorkflowStatus(refreshed) === resolveWorkflowStatus(current) &&
				(refreshed.paymentStatus ?? "menunggu_bayar") ===
					(current.paymentStatus ?? "menunggu_bayar") &&
				refreshed.updatedAt === current.updatedAt
			) {
				return current;
			}

			return refreshed;
		});
	}, [orders, isHistoryDetailOpen]);

	useEffect(() => {
		if (!isHistoryDetailOpen) {
			return;
		}

		const scrollKelolaToTop = () => {
			kelolaDialogScrollRef.current?.scrollTo({ top: 0, left: 0 });
			document.getElementById("kelola-dialog-scroll-top")?.focus({
				preventScroll: true,
			});
		};

		scrollKelolaToTop();
		const frame = window.requestAnimationFrame(scrollKelolaToTop);
		const timeoutA = window.setTimeout(scrollKelolaToTop, 80);
		const timeoutB = window.setTimeout(scrollKelolaToTop, 250);

		return () => {
			window.cancelAnimationFrame(frame);
			window.clearTimeout(timeoutA);
			window.clearTimeout(timeoutB);
		};
	}, [isHistoryDetailOpen, selectedHistoryOrder?.id]);

	const isManualPrescriptionMode = manualEntryMode === "manual_prescription";

	const patientNameSuggestions = useMemo(() => {
		if (!isManualPrescriptionMode) {
			return [];
		}

		const query = normalizeFieldSearch(manualPatientName);
		if (query.length < 1) {
			return patientOptions.slice(0, 6);
		}

		return patientOptions
			.filter((patient) => {
				const haystack = normalizeFieldSearch(
					`${patient.name} ${patient.nomorRM ?? ""} ${patient.email}`,
				);
				return haystack.includes(query);
			})
			.slice(0, 6);
	}, [isManualPrescriptionMode, manualPatientName, patientOptions]);

	const prescriptionNumberSuggestions = useMemo(() => {
		const query = manualNomorPeresepan.trim().toUpperCase();
		if (query.length < 1) {
			return prescriptionCatalog.slice(0, 6);
		}

		return prescriptionCatalog
			.filter((prescription) => {
				const haystack = `${prescription.nomorPeresepan} ${prescription.patientName} ${prescription.nomorRM}`;
				return haystack.toUpperCase().includes(query);
			})
			.slice(0, 6);
	}, [manualNomorPeresepan, prescriptionCatalog]);

	const loadPrescriptionCatalog = useCallback(async () => {
		setIsPrescriptionCatalogLoading(true);

		try {
			const response = await fetch("/api/demo/apoteker/dispensing/resep-list", {
				cache: "no-store",
			});

			if (!response.ok) {
				return;
			}

			const payload = (await response.json()) as PrescriptionCatalogResponse;
			setPrescriptionCatalog(payload.prescriptions ?? []);
		} catch {
			setPrescriptionCatalog([]);
		} finally {
			setIsPrescriptionCatalogLoading(false);
		}
	}, []);

	const loadOrders = useCallback(async () => {
		setIsLoading(true);
		setErrorMessage("");

		try {
			const response = await fetch("/api/demo/apoteker/dispensing", {
				cache: "no-store",
			});
			if (!response.ok) {
				throw new Error("Gagal mengambil data dispensing.");
			}

			const payload = (await response.json()) as DispensingResponse;
			setOrders(payload.orders);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Terjadi kesalahan.";
			setErrorMessage(message);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadOrders();
	}, [loadOrders]);

	const loadPatientOptions = useCallback(async () => {
		setIsPatientOptionsLoading(true);

		try {
			const response = await fetch("/api/demo/apoteker/dispensing/pasien", {
				cache: "no-store",
			});
			if (!response.ok) {
				throw new Error("Gagal mengambil daftar akun pasien.");
			}

			const payload =
				(await response.json()) as DispensingPatientOptionResponse;
			setPatientOptions(payload.patients);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Terjadi kesalahan.";
			setErrorMessage(message);
		} finally {
			setIsPatientOptionsLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadPatientOptions();
	}, [loadPatientOptions]);

	// Auto-focus on first input field when dialog opens
	useEffect(() => {
		if (isCreateDialogOpen && manualNomorRMRef.current) {
			manualNomorRMRef.current.focus();
		}
	}, [isCreateDialogOpen]);

	useEffect(() => {
		if (!isCreateDialogOpen) {
			return;
		}

		void loadPrescriptionCatalog();
	}, [isCreateDialogOpen, loadPrescriptionCatalog]);

	useEffect(() => {
		return () => {
			for (const timer of Object.values(medicineSearchTimersRef.current)) {
				clearTimeout(timer);
			}
		};
	}, []);

	// Keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			// Escape to close dialog
			if (event.key === "Escape" && isCreateDialogOpen) {
				setIsCreateDialogOpen(false);
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isCreateDialogOpen]);

	// Auto-refresh hanya jika NEXT_PUBLIC_DARSI_APOTEKER_AUTO_REFRESH=true
	useEffect(() => {
		if (!isApotekerAutoRefreshEnabled()) {
			return;
		}

		const interval = setInterval(() => {
			void loadOrders();
		}, APOTEKER_AUTO_REFRESH_INTERVAL_MS);

		return () => clearInterval(interval);
	}, [loadOrders]);

	async function fetchPrescriptionLookupData(
		normalizedNomorPeresepan: string,
		normalizedNomorRM?: string,
	): Promise<DispensingLookupPrescription> {
		const searchParams = new URLSearchParams({
			nomorPeresepan: normalizedNomorPeresepan,
		});

		if (normalizedNomorRM && normalizedNomorRM.length > 0) {
			searchParams.set("nomorRM", normalizedNomorRM);
		}

		const response = await fetch(
			`/api/demo/apoteker/dispensing/resep?${searchParams.toString()}`,
			{
				cache: "no-store",
			},
		);

		const payload = (await response.json()) as {
			error?: string;
		} & DispensingLookupResponse;

		if (!response.ok) {
			throw new Error(payload.error || "Gagal mengambil data resep.");
		}

		return payload.prescription;
	}

	async function fetchMedicineSuggestions(obatId: string, query: string) {
		const normalizedQuery = query.trim();
		if (normalizedQuery.length < 2) {
			setMedicineSuggestionsByObatId((current) => ({
				...current,
				[obatId]: [],
			}));
			return;
		}

		setMedicineSuggestionLoadingId(obatId);

		try {
			const searchParams = new URLSearchParams({
				nomorObat: normalizedQuery,
				includeCatalog: "true",
			});
			const response = await fetch(
				`/api/demo/apoteker/stok?${searchParams.toString()}`,
				{ cache: "no-store" },
			);

			if (!response.ok) {
				throw new Error("Gagal mencari obat.");
			}

			const payload = (await response.json()) as StockSearchResponse;
			const suggestions = dedupeMedicineSuggestions(
				(payload.items ?? []).map(mapStockItemToMedicineSuggestion),
			).slice(0, 8);

			setMedicineSuggestionsByObatId((current) => ({
				...current,
				[obatId]: suggestions,
			}));
		} catch {
			setMedicineSuggestionsByObatId((current) => ({
				...current,
				[obatId]: [],
			}));
		} finally {
			setMedicineSuggestionLoadingId(null);
		}
	}

	function scheduleMedicineSearch(obatId: string, query: string) {
		const existingTimer = medicineSearchTimersRef.current[obatId];
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		medicineSearchTimersRef.current[obatId] = setTimeout(() => {
			void fetchMedicineSuggestions(obatId, query);
		}, 280);
	}

	function clearMedicineSuggestions(obatId?: string) {
		if (obatId) {
			setMedicineSuggestionsByObatId((current) => {
				const next = { ...current };
				delete next[obatId];
				return next;
			});
			return;
		}

		setMedicineSuggestionsByObatId({});
	}

	// Handlers for dynamic medication array management
	function handleAddMedication() {
		const newId = `med-${Date.now()}`;
		setObatList([
			...obatList,
			{ id: newId, nomorObat: "", medicineName: "", dosage: "", quantity: 1 },
		]);
		setActiveMedicineObatId(newId);
		setHighlightedMedicineIdx(0);
	}

	function handleRemoveMedication(id: string) {
		if (obatList.length <= 1) {
			setErrorMessage("Minimal harus ada 1 baris obat.");
			return;
		}
		setObatList(obatList.filter((item) => item.id !== id));
		if (activeMedicineObatId === id) {
			setActiveMedicineObatId(null);
		}
		clearMedicineSuggestions(id);
	}

	function handleUpdateMedication(
		id: string,
		field: keyof MedicationItem,
		value: string | number,
	) {
		setObatList(
			obatList.map((item) =>
				item.id === id ? { ...item, [field]: value } : item,
			),
		);
	}

	function handleMedicineNameChange(idx: number, value: string) {
		const obat = obatList[idx];
		if (!obat) {
			return;
		}

		setObatList(
			obatList.map((item) =>
				item.id === obat.id
					? {
							...item,
							medicineName: value,
							nomorObat:
								normalizeFieldSearch(item.medicineName) ===
								normalizeFieldSearch(value)
									? item.nomorObat
									: "",
						}
					: item,
			),
		);
		setActiveMedicineObatId(obat.id);
		setHighlightedMedicineIdx(0);

		const query = value.trim();
		if (query.length < 2) {
			clearMedicineSuggestions(obat.id);
			return;
		}

		scheduleMedicineSearch(obat.id, query);
	}

	function applyMedicineToRow(idx: number, medicine: MedicineSuggestion) {
		const obat = obatList[idx];
		if (!obat) {
			return;
		}

		setObatList(
			obatList.map((item) =>
				item.id === obat.id
					? {
							...item,
							nomorObat: medicine.nomorObat.trim().toUpperCase(),
							medicineName: medicine.nama,
							dosage: item.dosage.trim()
								? item.dosage
								: inferDefaultDosage(medicine.nama),
						}
					: item,
			),
		);
		clearMedicineSuggestions(obat.id);
		setActiveMedicineObatId(null);
	}

	function handleSelectMedicineFromSuggestion(
		idx: number,
		medicine: MedicineSuggestion,
	) {
		applyMedicineToRow(idx, medicine);
	}

	function tryAutoMatchMedicineOnBlur(idx: number) {
		const obat = obatList[idx];
		if (!obat) {
			return;
		}

		const suggestions = dedupeMedicineSuggestions(
			medicineSuggestionsByObatId[obat.id] ?? [],
		);
		const match = findBestMedicineMatch(obat.medicineName, suggestions);
		if (!match) {
			return;
		}

		const normalizedNomor = match.nomorObat.trim().toUpperCase();
		const normalizedName = normalizeFieldSearch(obat.medicineName);
		const normalizedMatchName = normalizeFieldSearch(match.nama);

		if (
			obat.nomorObat.trim().length > 0 &&
			obat.nomorObat.trim().toUpperCase() !== normalizedNomor &&
			normalizedName !== normalizedMatchName
		) {
			return;
		}

		if (
			obat.nomorObat.trim().toUpperCase() === normalizedNomor &&
			normalizedName === normalizedMatchName
		) {
			return;
		}

		applyMedicineToRow(idx, match);
	}

	function handleMedicineNameKeyDown(
		idx: number,
		event: React.KeyboardEvent<HTMLInputElement>,
	) {
		const obat = obatList[idx];
		if (!obat || activeMedicineObatId !== obat.id) {
			return;
		}

		const suggestions = dedupeMedicineSuggestions(
			medicineSuggestionsByObatId[obat.id] ?? [],
		);
		if (suggestions.length === 0) {
			return;
		}

		if (event.key === "ArrowDown") {
			event.preventDefault();
			setHighlightedMedicineIdx(
				(current) => (current + 1) % suggestions.length,
			);
			return;
		}

		if (event.key === "ArrowUp") {
			event.preventDefault();
			setHighlightedMedicineIdx(
				(current) => (current - 1 + suggestions.length) % suggestions.length,
			);
			return;
		}

		if (event.key === "Enter" && suggestions[highlightedMedicineIdx]) {
			event.preventDefault();
			handleSelectMedicineFromSuggestion(
				idx,
				suggestions[highlightedMedicineIdx],
			);
			return;
		}

		if (event.key === "Escape") {
			event.preventDefault();
			clearMedicineSuggestions(obat.id);
			setActiveMedicineObatId(null);
		}
	}

	function handleEditMedicineNameChange(value: string) {
		const keepNomor =
			normalizeFieldSearch(editMedicineName) === normalizeFieldSearch(value);
		setEditMedicineName(value);
		if (!keepNomor) {
			setEditNomorObat("");
		}
		setActiveMedicineObatId(EDIT_MEDICINE_SUGGESTION_ID);
		setHighlightedEditMedicineIdx(0);

		const query = value.trim();
		if (query.length < 2) {
			clearMedicineSuggestions(EDIT_MEDICINE_SUGGESTION_ID);
			return;
		}

		scheduleMedicineSearch(EDIT_MEDICINE_SUGGESTION_ID, query);
	}

	function applyEditMedicine(medicine: MedicineSuggestion) {
		setEditNomorObat(medicine.nomorObat.trim().toUpperCase());
		setEditMedicineName(medicine.nama);
		setEditDosage((current) =>
			current.trim() ? current : inferDefaultDosage(medicine.nama),
		);
		clearMedicineSuggestions(EDIT_MEDICINE_SUGGESTION_ID);
		setActiveMedicineObatId(null);
	}

	function handleSelectEditMedicineFromSuggestion(medicine: MedicineSuggestion) {
		applyEditMedicine(medicine);
	}

	function tryAutoMatchEditMedicineOnBlur() {
		const suggestions = dedupeMedicineSuggestions(
			medicineSuggestionsByObatId[EDIT_MEDICINE_SUGGESTION_ID] ?? [],
		);
		const match = findBestMedicineMatch(editMedicineName, suggestions);
		if (!match) {
			return;
		}

		const normalizedNomor = match.nomorObat.trim().toUpperCase();
		const normalizedName = normalizeFieldSearch(editMedicineName);
		const normalizedMatchName = normalizeFieldSearch(match.nama);

		if (
			editNomorObat.trim().length > 0 &&
			editNomorObat.trim().toUpperCase() !== normalizedNomor &&
			normalizedName !== normalizedMatchName
		) {
			return;
		}

		if (
			editNomorObat.trim().toUpperCase() === normalizedNomor &&
			normalizedName === normalizedMatchName
		) {
			return;
		}

		applyEditMedicine(match);
	}

	function handleEditMedicineNameKeyDown(
		event: React.KeyboardEvent<HTMLInputElement>,
	) {
		if (activeMedicineObatId !== EDIT_MEDICINE_SUGGESTION_ID) {
			return;
		}

		const suggestions = dedupeMedicineSuggestions(
			medicineSuggestionsByObatId[EDIT_MEDICINE_SUGGESTION_ID] ?? [],
		);
		if (suggestions.length === 0) {
			return;
		}

		if (event.key === "ArrowDown") {
			event.preventDefault();
			setHighlightedEditMedicineIdx(
				(current) => (current + 1) % suggestions.length,
			);
			return;
		}

		if (event.key === "ArrowUp") {
			event.preventDefault();
			setHighlightedEditMedicineIdx(
				(current) => (current - 1 + suggestions.length) % suggestions.length,
			);
			return;
		}

		if (event.key === "Enter" && suggestions[highlightedEditMedicineIdx]) {
			event.preventDefault();
			handleSelectEditMedicineFromSuggestion(
				suggestions[highlightedEditMedicineIdx],
			);
			return;
		}

		if (event.key === "Escape") {
			event.preventDefault();
			clearMedicineSuggestions(EDIT_MEDICINE_SUGGESTION_ID);
			setActiveMedicineObatId(null);
		}
	}

	function handleApplyQuickDosage(idx: number, dosage: string) {
		handleUpdateMedication(obatList[idx].id, "dosage", dosage);
	}

	function handleSelectPatientSuggestion(patient: DispensingPatientOption) {
		setManualPatientName(patient.name);
		setManualPatientUserId(patient.userId);
		if (patient.nomorRM) {
			setManualNomorRM(patient.nomorRM.toUpperCase());
		}
		setShowPatientSuggestions(false);
	}

	function handleSelectPrescriptionSuggestion(
		prescription: DemoPatientPaymentSummary,
	) {
		setManualNomorPeresepan(prescription.nomorPeresepan);
		setManualNomorRM(prescription.nomorRM);
		setManualPatientName(prescription.patientName);
		setManualDoctorName(prescription.doctorName);
		setShowPrescriptionSuggestions(false);

		const lookupPrescription: DispensingLookupPrescription = {
			nomorRM: prescription.nomorRM,
			nomorPeresepan: prescription.nomorPeresepan,
			patientName: prescription.patientName,
			doctorName: prescription.doctorName,
			items: prescription.items.map((item) => ({
				nomorObat: item.nomorObat,
				medicineName: item.medicineName,
				dosage: item.dosis,
				quantity: item.qty,
				keteranganObat: "",
			})),
		};

		setManualLookupPrescription(lookupPrescription);
		populateObatListFromPrescription(lookupPrescription);
	}

	function populateObatListFromPrescription(
		prescription: DispensingLookupPrescription,
	) {
		if (prescription.items.length === 0) {
			setObatList([
				{
					id: `med-${Date.now()}`,
					nomorObat: "",
					medicineName: "",
					dosage: "",
					quantity: 1,
				},
			]);
			return;
		}

		setObatList(
			prescription.items.map((item, index) => ({
				id: `med-${index + 1}-${Date.now()}`,
				nomorObat: item.nomorObat,
				medicineName: item.medicineName,
				dosage: item.dosage,
				quantity: item.quantity,
			})),
		);
		clearMedicineSuggestions();
		setActiveMedicineObatId(null);
	}

	async function handleLookupPrescription(
		event: React.FormEvent<HTMLFormElement>,
	) {
		event.preventDefault();
		setIsLookupLoading(true);
		setErrorMessage("");
		setLookupPrescription(null);

		const normalizedNomorRM = nomorRM.trim().toUpperCase();
		const normalizedNomorPeresepan = nomorPeresepan.trim().toUpperCase();

		if (!normalizedNomorRM || !normalizedNomorPeresepan) {
			setErrorMessage("Nomor RM dan nomor peresepan wajib diisi.");
			setIsLookupLoading(false);
			return;
		}

		try {
			const prescription = await fetchPrescriptionLookupData(
				normalizedNomorPeresepan,
				normalizedNomorRM,
			);

			setLookupPrescription(prescription);
			setNomorRM(prescription.nomorRM);
			setNomorPeresepan(prescription.nomorPeresepan);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Terjadi kesalahan.";
			setErrorMessage(message);
		} finally {
			setIsLookupLoading(false);
		}
	}

	function resetLookup() {
		setNomorRM("");
		setNomorPeresepan("");
		setLookupPrescription(null);
		setErrorMessage("");
	}

	function resetManualForm() {
		setManualPatientUserId("");
		setManualPatientName("");
		setManualNomorRM("");
		setManualNomorPeresepan("");
		setManualDoctorName("");
		setManualNomorObat("");
		setManualMedicineName("");
		setManualDosage("");
		setManualQuantity("1");
		setManualLookupPrescription(null);
		setManualSelectedNomorObat("");
		// Reset new dynamic medication array
		setObatList([
			{ id: "med-1", nomorObat: "", medicineName: "", dosage: "", quantity: 1 },
		]);
		setActiveMedicineObatId(null);
		setHighlightedMedicineIdx(0);
		setShowPatientSuggestions(false);
		setShowPrescriptionSuggestions(false);
		clearMedicineSuggestions();
		setErrorMessage("");
		setSuccessMessage("");
	}

	function setManualMode(mode: ManualEntryMode) {
		if (mode === manualEntryMode) {
			return;
		}

		setManualEntryMode(mode);
		setErrorMessage("");

		if (mode === "manual_prescription") {
			setManualLookupPrescription(null);
			setManualSelectedNomorObat("");
		}
	}

	function _handleManualPatientAccountChange(userId: string) {
		setManualPatientUserId(userId);

		if (!userId) {
			return;
		}

		const selectedPatient = patientOptions.find(
			(item) => item.userId === userId,
		);
		if (!selectedPatient) {
			return;
		}

		setManualPatientName(selectedPatient.name);

		if (selectedPatient.nomorRM) {
			setManualNomorRM(selectedPatient.nomorRM.toUpperCase());
		}
	}

	function applyManualPrescriptionLookup(
		prescription: DispensingLookupPrescription,
		preferredNomorObat?: string,
	) {
		setManualLookupPrescription(prescription);
		setManualPatientName(prescription.patientName);
		setManualDoctorName(prescription.doctorName);
		setManualNomorRM(prescription.nomorRM);
		setManualNomorPeresepan(prescription.nomorPeresepan);

		const selectedItem =
			(preferredNomorObat
				? prescription.items.find(
						(item) => item.nomorObat === preferredNomorObat,
					)
				: undefined) ?? prescription.items[0];

		if (!selectedItem) {
			setManualSelectedNomorObat("");
			setManualNomorObat("");
			setManualMedicineName("");
			setManualDosage("");
			setManualQuantity("1");
			return;
		}

		setManualSelectedNomorObat(selectedItem.nomorObat);
		setManualNomorObat(selectedItem.nomorObat);
		setManualMedicineName(selectedItem.medicineName);
		setManualDosage(selectedItem.dosage);
		setManualQuantity(String(selectedItem.quantity));
		populateObatListFromPrescription(prescription);
	}

	function _handleManualPrescriptionItemChange(nomorObat: string) {
		setManualSelectedNomorObat(nomorObat);

		if (!manualLookupPrescription) {
			return;
		}

		const selectedItem = manualLookupPrescription.items.find(
			(item) => item.nomorObat === nomorObat,
		);
		if (!selectedItem) {
			return;
		}

		setManualNomorObat(selectedItem.nomorObat);
		setManualMedicineName(selectedItem.medicineName);
		setManualDosage(selectedItem.dosage);
		setManualQuantity(String(selectedItem.quantity));
	}

	async function handleManualLookupPrescription() {
		if (isManualPrescriptionMode) {
			setErrorMessage(
				"Mode input resep manual aktif. Ganti ke mode resep dokter jika ingin isi otomatis.",
			);
			return;
		}

		const normalizedNomorRM = manualNomorRM.trim().toUpperCase();
		const normalizedNomorPeresepan = manualNomorPeresepan.trim().toUpperCase();

		if (!normalizedNomorPeresepan) {
			setErrorMessage("Nomor peresepan wajib diisi untuk isi otomatis.");
			return;
		}

		setIsManualLookupLoading(true);
		setErrorMessage("");

		try {
			const prescription = await fetchPrescriptionLookupData(
				normalizedNomorPeresepan,
				normalizedNomorRM || undefined,
			);

			applyManualPrescriptionLookup(prescription);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Terjadi kesalahan.";
			setErrorMessage(message);
		} finally {
			setIsManualLookupLoading(false);
		}
	}

	async function handleCreateManualOrder(
		event: React.FormEvent<HTMLFormElement>,
	) {
		event.preventDefault();
		setErrorMessage("");

		const normalizedNomorRM = manualNomorRM.trim().toUpperCase();
		const normalizedNomorPeresepan = manualNomorPeresepan.trim().toUpperCase();
		const normalizedManualPatientName = manualPatientName.trim();
		const normalizedManualDoctorName = manualDoctorName.trim();
		const shouldAutoCreatePrescription = isManualPrescriptionMode;

		if (!normalizedNomorPeresepan) {
			setErrorMessage("Nomor peresepan wajib diisi.");
			return;
		}

		// Validate medication list
		const validObatList = obatList.filter(
			(obat) => obat.medicineName.trim().length > 0,
		);
		if (validObatList.length === 0) {
			setErrorMessage("Minimal harus ada 1 obat yang terisi.");
			return;
		}

		setIsManualSubmitting(true);

		try {
			// Process each medication in the list
			for (const obat of validObatList) {
				const normalizedNomorObat = obat.nomorObat.trim().toUpperCase();
				const normalizedMedicineName = obat.medicineName.trim();
				const normalizedDosage = obat.dosage.trim();

				let payloadBody: Record<string, unknown>;

				if (shouldAutoCreatePrescription) {
					if (obat.quantity <= 0) {
						throw new Error(
							`Obat "${normalizedMedicineName}" harus memiliki jumlah lebih dari 0.`,
						);
					}

					payloadBody = {
						patientName: normalizedManualPatientName || undefined,
						patientUserId: manualPatientUserId || undefined,
						nomorRM: normalizedNomorRM || undefined,
						nomorPeresepan: normalizedNomorPeresepan,
						doctorName: normalizedManualDoctorName || undefined,
						nomorObat: normalizedNomorObat || undefined,
						medicineName: normalizedMedicineName,
						dosage: normalizedDosage || undefined,
						quantity: obat.quantity,
						autoCreatePrescription: true,
					};
				} else {
					const hasManualLookupMatch =
						manualLookupPrescription &&
						manualLookupPrescription.nomorPeresepan.toUpperCase() ===
							normalizedNomorPeresepan &&
						(normalizedNomorRM.length === 0 ||
							manualLookupPrescription.nomorRM.toUpperCase() ===
								normalizedNomorRM);

					const prescription = hasManualLookupMatch
						? manualLookupPrescription
						: await fetchPrescriptionLookupData(
								normalizedNomorPeresepan,
								normalizedNomorRM || undefined,
							);

					if (prescription.items.length === 0) {
						throw new Error(
							"Resep tidak memiliki item obat untuk diproses dispensing.",
						);
					}

					payloadBody = {
						patientName: prescription.patientName,
						patientUserId: manualPatientUserId || undefined,
						nomorRM: prescription.nomorRM,
						nomorPeresepan: prescription.nomorPeresepan,
						doctorName: prescription.doctorName,
						nomorObat: normalizedNomorObat || undefined,
						medicineName: normalizedMedicineName,
						dosage: normalizedDosage || undefined,
						quantity: obat.quantity,
						autoCreatePrescription: false,
						allowCustomPrescriptionItem: true,
					};
				}

				const response = await fetch("/api/demo/apoteker/dispensing", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payloadBody),
				});

				const payload = (await response.json()) as {
					error?: string;
				};

				if (!response.ok) {
					throw new Error(
						payload.error ||
							`Gagal membuat order untuk obat "${normalizedMedicineName}".`,
					);
				}
			}

			resetManualForm();
			await Promise.all([loadOrders(), loadPatientOptions()]);
			void loadPrescriptionCatalog();
			setSuccessMessage(
				`Resep baru berhasil ditambahkan (${validObatList.length} item obat). Data antrean diperbarui.`,
			);
			setIsCreateDialogOpen(false);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Terjadi kesalahan.";
			setErrorMessage(message);
		} finally {
			setIsManualSubmitting(false);
		}
	}

	async function handleCreateOrder(nomorObat: string) {
		if (!lookupPrescription) {
			setErrorMessage(
				"Data resep belum tersedia. Silakan cari resep terlebih dahulu.",
			);
			return;
		}

		setIsSubmitting(true);
		setProcessingNomorObat(nomorObat);
		setErrorMessage("");

		try {
			const response = await fetch("/api/demo/apoteker/dispensing", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					nomorRM: lookupPrescription.nomorRM,
					nomorPeresepan: lookupPrescription.nomorPeresepan,
					nomorObat,
				}),
			});

			const payload = (await response.json()) as {
				error?: string;
			};

			if (!response.ok) {
				throw new Error(payload.error || "Gagal membuat order dispensing.");
			}

			await loadOrders();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Terjadi kesalahan.";
			setErrorMessage(message);
		} finally {
			setIsSubmitting(false);
			setProcessingNomorObat(null);
		}
	}

	async function patchDispensingWorkflow(
		orderId: string,
		workflowStatus: DispensingWorkflowTransitionStatus,
	) {
		const response = await fetch("/api/demo/apoteker/dispensing", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				orderId,
				workflowStatus,
			}),
		});

		const payload = await readApiJsonPayload<{
			error?: string;
			details?: {
				medicineName?: string;
				available?: number;
				requested?: number;
			};
		}>(response, "Gagal memperbarui status peracikan.");

		if (!response.ok) {
			const stockDetails = payload.details;
			if (
				stockDetails &&
				typeof stockDetails.available === "number" &&
				typeof stockDetails.requested === "number"
			) {
				const medicineLabel = stockDetails.medicineName
					? ` (${stockDetails.medicineName})`
					: "";
				throw new Error(
					payload.error ||
						`Stok tidak mencukupi${medicineLabel}. Tersedia ${stockDetails.available}, diminta ${stockDetails.requested}.`,
				);
			}

			throw new Error(payload.error || "Gagal memperbarui status peracikan.");
		}
	}

	async function handleUpdateWorkflow(
		orderId: string,
		workflowStatus: DispensingWorkflowTransitionStatus,
	) {
		setIsUpdatingWorkflow(true);
		setUpdatingOrderId(orderId);
		setErrorMessage("");

		try {
			await patchDispensingWorkflow(orderId, workflowStatus);
			await loadOrders();
			setSuccessMessage("Status peracikan berhasil diperbarui.");
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Terjadi kesalahan.";
			setErrorMessage(message);
		} finally {
			setIsUpdatingWorkflow(false);
			setUpdatingOrderId(null);
		}
	}

	async function handleUpdateWorkflowForGroup(
		group: DispensingPrescriptionQueueGroup,
		workflowStatus: DispensingWorkflowTransitionStatus,
	) {
		const eligibleOrders = group.orders.filter((order) => {
			const status = resolveWorkflowStatus(order);
			if (status === "diserahkan" || status === "cancel") {
				return false;
			}
			const nextAction = getNextWorkflowAction(status);
			return nextAction?.target === workflowStatus;
		});

		if (eligibleOrders.length === 0) {
			setErrorMessage(
				"Tidak ada obat pada resep ini yang siap diproses ke tahap berikutnya.",
			);
			return;
		}

		setIsUpdatingWorkflow(true);
		setUpdatingGroupKey(group.key);
		setErrorMessage("");

		try {
			for (const order of eligibleOrders) {
				await patchDispensingWorkflow(order.id, workflowStatus);
			}

			await loadOrders();
			setSuccessMessage(
				`Status peracikan diperbarui untuk ${eligibleOrders.length} obat dalam resep ${group.nomorPeresepan}.`,
			);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Terjadi kesalahan.";
			setErrorMessage(message);
			await loadOrders();
		} finally {
			setIsUpdatingWorkflow(false);
			setUpdatingGroupKey(null);
			setUpdatingOrderId(null);
		}
	}

	async function handleManageWorkflowFromHistory(
		target: DispensingWorkflowTransitionStatus,
	) {
		if (!selectedHistoryOrder) {
			return;
		}

		await handleUpdateWorkflow(selectedHistoryOrder.id, target);
	}

	async function handleGenerateLabelForOrder(order: DemoDispensingOrder) {
		setIsGeneratingLabel(true);
		setLabelOrderId(order.id);
		setErrorMessage("");

		try {
			const response = await fetch("/api/demo/apoteker/cetak-label", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					patientName: order.patientName,
					medicineName: order.medicineName,
					dosage: order.dosage,
					duration: formatLabelDurationFromQuantity(order.quantity),
					instructions: order.nomorPeresepan
						? `Nomor resep: ${order.nomorPeresepan}. Verifikasi identitas pasien sebelum serah obat.`
						: "Verifikasi identitas pasien sebelum serah obat.",
				}),
			});

			const payload = (await response.json()) as LabelPreviewResponse;

			if (!response.ok || !payload.label) {
				throw new Error(payload.error || "Gagal membuat preview label.");
			}

			setLabelPreview(payload.label);
			setLabelPreviewOrder({
				id: order.id,
				nomorRM: order.nomorRM,
				nomorPeresepan: order.nomorPeresepan,
				patientName: order.patientName,
				medicineName: order.medicineName,
				dosage: order.dosage,
			});
			setSuccessMessage(
				"Preview label siap dicetak. Gunakan tombol cetak pada panel riwayat.",
			);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Terjadi kesalahan.";
			setErrorMessage(message);
		} finally {
			setIsGeneratingLabel(false);
			setLabelOrderId(null);
		}
	}

	function handlePrintLabelPreview() {
		if (!labelPreview) {
			return;
		}

		const printWindow = window.open("", "_blank", "width=420,height=620");
		if (!printWindow) {
			setErrorMessage(
				"Gagal membuka jendela cetak. Pastikan pop-up browser tidak diblokir.",
			);
			return;
		}

		const html = `
      <html>
        <head>
          <title>Cetak Label ${escapeLabelText(labelPreview.labelId)}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; }
            .label { border: 1px solid #333; border-radius: 10px; padding: 16px; max-width: 360px; }
            .title { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
            .row { margin: 4px 0; font-size: 12px; color: #111827; }
            .small { margin-top: 10px; padding-top: 10px; border-top: 1px dashed #9ca3af; font-size: 11px; color: #374151; }
          </style>
        </head>
        <body>
          <div class="label">
            <div class="title">${escapeLabelText(labelPreview.apotekName)}</div>
            <div class="row">Label ID: ${escapeLabelText(labelPreview.labelId)}</div>
            <div class="row">Pasien: ${escapeLabelText(labelPreview.patientName)}</div>
            <div class="row">Obat: ${escapeLabelText(labelPreview.medicineName)}</div>
            <div class="row">Aturan: ${escapeLabelText(labelPreview.dosage)}</div>
            <div class="row">Durasi: ${escapeLabelText(labelPreview.duration)}</div>
            <div class="row">Instruksi: ${escapeLabelText(labelPreview.instructions)}</div>
            <div class="small">Barcode: ${escapeLabelText(labelPreview.barcode)}</div>
          </div>
        </body>
      </html>
    `;

		printWindow.document.open();
		printWindow.document.write(html);
		printWindow.document.close();
		printWindow.focus();
		printWindow.print();
	}

	async function _handleResetDispensingData() {
		if (isResettingData) {
			return;
		}

		const confirmed = window.confirm(
			"Semua data dispensing lama akan dihapus (order, resep, pembayaran, dan transaksi dispensing). Lanjutkan?",
		);

		if (!confirmed) {
			return;
		}

		setIsResettingData(true);
		setErrorMessage("");
		setSuccessMessage("");

		try {
			const response = await fetch(
				"/api/demo/apoteker/dispensing?confirm=RESET_DISPENSING_DATA",
				{
					method: "DELETE",
				},
			);

			const payload = (await response.json()) as {
				error?: string;
			} & DispensingResetResponse;

			if (!response.ok) {
				throw new Error(
					payload.error || "Gagal mengosongkan data dispensing lama.",
				);
			}

			resetLookup();
			resetManualForm();
			setOrderListQuery("");
			setLookupPrescription(null);
			setManualLookupPrescription(null);

			await Promise.all([loadOrders(), loadPatientOptions()]);
			setSuccessMessage(
				`Data lama dikosongkan: ${payload.reset.deletedOrders} order, ${payload.reset.deletedPrescriptions} resep, ${payload.reset.deletedPayments} pembayaran, ${payload.reset.deletedPatients} pasien, ${payload.reset.deletedTransactions} transaksi dispensing.`,
			);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Terjadi kesalahan.";
			setErrorMessage(message);
		} finally {
			setIsResettingData(false);
		}
	}

	function resetManageOrderForm(order: DemoDispensingOrder) {
		setEditNomorObat(order.nomorObat ?? "");
		setEditMedicineName(order.medicineName);
		setEditDosage(order.dosage);
		setEditQuantity(String(order.quantity));
		setCancelReason("");
		clearMedicineSuggestions(EDIT_MEDICINE_SUGGESTION_ID);
		setActiveMedicineObatId(null);
		setHighlightedEditMedicineIdx(0);
	}

	function handleOpenPrescriptionGroup(group: DispensingPrescriptionQueueGroup) {
		const primaryOrder =
			group.orders.find((order) => {
				const status = resolveWorkflowStatus(order);
				return status !== "diserahkan" && status !== "cancel";
			}) ?? group.orders[0];

		if (!primaryOrder) {
			return;
		}

		setSelectedHistoryOrder(primaryOrder);
		resetManageOrderForm(primaryOrder);
		setIsHistoryDetailOpen(true);
	}

	async function handleCancelEntirePrescription() {
		const cancellableOrders = relatedPrescriptionOrders.filter((order) => {
			const status = resolveWorkflowStatus(order);
			return status !== "diserahkan" && status !== "cancel";
		});

		if (cancellableOrders.length === 0) {
			setErrorMessage("Semua obat pada resep ini sudah selesai atau dibatalkan.");
			return;
		}

		const refundTotal = cancellableOrders.reduce((total, order) => {
			if ((order.paymentStatus ?? "menunggu_bayar") !== "lunas") {
				return total;
			}
			return total + Math.max(0, order.quantity * 5000);
		}, 0);

		const resepLabel =
			selectedHistoryOrder?.nomorPeresepan ??
			cancellableOrders[0]?.nomorPeresepan ??
			"-";
		const confirmMessage =
			refundTotal > 0
				? `Batalkan peracikan untuk ${cancellableOrders.length} obat pada resep ${resepLabel}? Total refund Rp ${refundTotal.toLocaleString("id-ID")} akan dicatat.`
				: `Batalkan peracikan untuk ${cancellableOrders.length} obat pada resep ${resepLabel}?`;

		if (!window.confirm(confirmMessage)) {
			return;
		}

		setIsCancelingOrder(true);
		setErrorMessage("");

		let refundedTotal = 0;
		let cancelledCount = 0;

		try {
			for (const order of cancellableOrders) {
				const response = await fetch("/api/demo/apoteker/dispensing", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						orderId: order.id,
						cancel: true,
						cancelReason:
							cancelReason.trim() ||
							"Peracikan dibatalkan dari kelola resep (gabungan)",
					}),
				});

				const payload = await readApiJsonPayload<{
					error?: string;
					refunded?: boolean;
					refundAmount?: number;
				}>(response, "Gagal membatalkan peracikan.");

				if (!response.ok) {
					throw new Error(
						payload.error ||
							`Gagal membatalkan obat ${order.medicineName}.`,
					);
				}

				cancelledCount += 1;
				if (payload.refunded) {
					refundedTotal += payload.refundAmount ?? 0;
				}
			}

			await loadOrders();
			setSuccessMessage(
				refundedTotal > 0
					? `${cancelledCount} obat dibatalkan. Refund total Rp ${refundedTotal.toLocaleString("id-ID")} dicatat.`
					: `${cancelledCount} obat berhasil dibatalkan.`,
			);
			setIsHistoryDetailOpen(false);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Terjadi kesalahan.";
			setErrorMessage(message);
			await loadOrders();
		} finally {
			setIsCancelingOrder(false);
		}
	}

	async function handleSaveOrderDetails() {
		if (!selectedHistoryOrder) {
			return;
		}

		const normalizedMedicineName = editMedicineName.trim();
		const normalizedDosage = editDosage.trim();
		const parsedQuantity = Number.parseInt(editQuantity, 10);

		if (normalizedMedicineName.length < 2) {
			setErrorMessage("Nama obat wajib diisi untuk menyimpan perubahan.");
			return;
		}

		if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
			setErrorMessage("Jumlah obat tidak valid.");
			return;
		}

		setIsSavingOrderDetails(true);
		setErrorMessage("");

		try {
			const response = await fetch("/api/demo/apoteker/dispensing", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					orderId: selectedHistoryOrder.id,
					nomorObat: editNomorObat.trim().toUpperCase() || undefined,
					medicineName: normalizedMedicineName,
					dosage: normalizedDosage || undefined,
					quantity: parsedQuantity,
				}),
			});

			const payload = await readApiJsonPayload<{
				error?: string;
				order?: DemoDispensingOrder;
			}>(response, "Gagal memperbarui data obat dispensing.");

			if (!response.ok) {
				throw new Error(payload.error || "Gagal memperbarui data obat dispensing.");
			}

			if (payload.order) {
				setSelectedHistoryOrder(payload.order);
				resetManageOrderForm(payload.order);
			}

			await loadOrders();
			setSuccessMessage("Data obat dispensing berhasil diperbarui.");
			setIsEditResepOpen(false);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Terjadi kesalahan.";
			setErrorMessage(message);
		} finally {
			setIsSavingOrderDetails(false);
		}
	}

	function handleOpenEditResepDialog() {
		if (!selectedHistoryOrder) {
			return;
		}
		resetManageOrderForm(selectedHistoryOrder);
		clearMedicineSuggestions(EDIT_MEDICINE_SUGGESTION_ID);
		setActiveMedicineObatId(null);
		setHighlightedEditMedicineIdx(0);
		setIsEditResepOpen(true);
	}

	async function handleCancelDispensingOrder() {
		if (!selectedHistoryOrder) {
			return;
		}

		const isPaid =
			(selectedHistoryOrder.paymentStatus ?? "menunggu_bayar") === "lunas";
		const refundAmount = Math.max(0, selectedHistoryOrder.quantity * 5000);
		const confirmMessage = isPaid
			? `Batalkan peresepan ${selectedHistoryOrder.nomorPeresepan ?? "-"} untuk ${selectedHistoryOrder.patientName}? Pembayaran lunas akan dikembalikan (refund) sebesar Rp ${refundAmount.toLocaleString("id-ID")}.`
			: `Batalkan peresepan ${selectedHistoryOrder.nomorPeresepan ?? "-"} untuk ${selectedHistoryOrder.patientName}?`;

		if (!window.confirm(confirmMessage)) {
			return;
		}

		setIsCancelingOrder(true);
		setErrorMessage("");

		try {
			const response = await fetch("/api/demo/apoteker/dispensing", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					orderId: selectedHistoryOrder.id,
					cancel: true,
					cancelReason: cancelReason.trim() || undefined,
				}),
			});

			const payload = await readApiJsonPayload<{
				error?: string;
				order?: DemoDispensingOrder;
				refunded?: boolean;
				refundAmount?: number;
			}>(response, "Gagal membatalkan order dispensing.");

			if (!response.ok) {
				throw new Error(payload.error || "Gagal membatalkan order dispensing.");
			}

			if (payload.order) {
				setSelectedHistoryOrder(payload.order);
				resetManageOrderForm(payload.order);
			}

			await loadOrders();
			setSuccessMessage(
				payload.refunded
					? `Peresepan dibatalkan. Refund Rp ${(payload.refundAmount ?? 0).toLocaleString("id-ID")} dicatat untuk pasien.`
					: "Peresepan berhasil dibatalkan.",
			);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Terjadi kesalahan.";
			setErrorMessage(message);
		} finally {
			setIsCancelingOrder(false);
		}
	}

	const selectedHistoryWorkflowStatus = selectedHistoryOrder
		? resolveWorkflowStatus(selectedHistoryOrder)
		: null;
	const selectedHistoryWorkflowBadge = selectedHistoryWorkflowStatus
		? statusBadge(selectedHistoryWorkflowStatus)
		: null;
	const selectedHistoryPaymentBadge = selectedHistoryOrder
		? paymentStatusBadge(selectedHistoryOrder.paymentStatus ?? "menunggu_bayar")
		: null;
	const selectedHistoryNextAction = selectedHistoryWorkflowStatus
		? getNextWorkflowAction(selectedHistoryWorkflowStatus)
		: null;
	const canManageActiveOrder =
		Boolean(selectedHistoryWorkflowStatus) &&
		selectedHistoryWorkflowStatus !== "diserahkan" &&
		selectedHistoryWorkflowStatus !== "cancel";
	const isSelectedHistoryUpdating =
		isUpdatingWorkflow && updatingOrderId === selectedHistoryOrder?.id;
	const isSelectedHistoryGeneratingLabel =
		isGeneratingLabel && labelOrderId === selectedHistoryOrder?.id;
	const isSelectedHistoryPaymentLunas =
		(selectedHistoryOrder?.paymentStatus ?? "menunggu_bayar") === "lunas";

	const workflowTimelineSteps = [
		{ key: "menunggu_pembayaran", label: "Pembayaran" },
		{ key: "sedang_diracik", label: "Diracik" },
		{ key: "siap_diserahkan", label: "Siap diserahkan" },
		{ key: "diserahkan", label: "Diserahkan" },
	] as const;

	const activeWorkflowStepIndex = selectedHistoryWorkflowStatus
		? (() => {
				if (
					selectedHistoryWorkflowStatus === "menunggu_validasi_resep" ||
					selectedHistoryWorkflowStatus === "menunggu_pembayaran"
				) {
					return 0;
				}
				if (
					selectedHistoryWorkflowStatus === "siap_diracik" ||
					selectedHistoryWorkflowStatus === "sedang_diracik"
				) {
					return 1;
				}
				if (selectedHistoryWorkflowStatus === "siap_diserahkan") {
					return 2;
				}
				if (selectedHistoryWorkflowStatus === "diserahkan") {
					return 3;
				}
				return -1;
			})()
		: -1;

	return (
		<div className="space-y-6">
			<div className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-5 py-5 shadow-sm shadow-emerald-950/5 dark:border-emerald-900/60 dark:bg-emerald-950/20">
				<div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
					<div className="max-w-2xl">
						<div className="mb-2 inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700 text-xs font-medium dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
							<PackageCheck className="h-3.5 w-3.5" />
							Farmasi klinik
						</div>
						<h1 className="font-semibold text-2xl text-emerald-950 tracking-tight md:text-3xl dark:text-emerald-50">
							Dispensing
						</h1>
						<p className="mt-1.5 text-emerald-900/70 text-sm dark:text-emerald-100/70">
							Kelola antrean peracikan, status pembayaran, label obat, dan serah
							terima pasien dalam satu alur kerja.
						</p>
					</div>
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
						<Button
							type="button"
							variant="outline"
							className={secondaryActionClass}
							onClick={() => void loadOrders()}
							disabled={isLoading || isResettingData}
						>
							<RotateCcw
								className={isLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"}
							/>
							Refresh
						</Button>
						<Button
							type="button"
							size="lg"
							className={primaryActionClass}
							onClick={() => setIsCreateDialogOpen(true)}
						>
							<FilePlus2 className="h-4 w-4" />
							Tambah Resep
						</Button>
					</div>
				</div>
			</div>

			{/* Ringkasan statistik — di atas filter & tabel antrean */}
			<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
				<Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100/50 shadow-sm dark:border-blue-900/60 dark:from-blue-950/30 dark:to-blue-950/10">
					<CardContent className="p-5">
						<div className="flex items-center justify-between gap-4">
							<div>
								<p className="text-blue-800 text-xs font-semibold uppercase tracking-wide dark:text-blue-200">
									Total resep masuk
								</p>
								<p className="mt-2 font-semibold text-3xl text-blue-950 dark:text-blue-50">
									{statistics.total}
								</p>
								<p className="mt-1 text-blue-800/70 text-xs dark:text-blue-100/70">
									{periodSummaryLabel}
								</p>
							</div>
							<div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
								<ClipboardList className="h-5 w-5" />
							</div>
						</div>
					</CardContent>
				</Card>

				<Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100/50 shadow-sm dark:border-amber-900/60 dark:from-amber-950/30 dark:to-amber-950/10">
					<CardContent className="p-5">
						<div className="flex items-center justify-between gap-4">
							<div>
								<p className="text-amber-800 text-xs font-semibold uppercase tracking-wide dark:text-amber-200">
									Menunggu antrean
								</p>
								<p className="mt-2 font-semibold text-3xl text-amber-950 dark:text-amber-50">
									{statistics.waiting}
								</p>
								<p className="mt-1 text-amber-800/70 text-xs dark:text-amber-100/70">
									Belum selesai · {periodSummaryLabel}
								</p>
							</div>
							<div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-500 text-white shadow-sm">
								<Clock3 className="h-5 w-5" />
							</div>
						</div>
					</CardContent>
				</Card>

				<Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100/50 shadow-sm dark:border-emerald-900/60 dark:from-emerald-950/30 dark:to-emerald-950/10">
					<CardContent className="p-5">
						<div className="flex items-center justify-between gap-4">
							<div>
								<p className="text-emerald-800 text-xs font-semibold uppercase tracking-wide dark:text-emerald-200">
									Selesai hari ini
								</p>
								<p className="mt-2 font-semibold text-3xl text-emerald-950 dark:text-emerald-50">
									{statistics.completed}
								</p>
								<p className="mt-1 text-emerald-800/70 text-xs dark:text-emerald-100/70">
									Diserahkan · {periodSummaryLabel}
								</p>
							</div>
							<div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm">
								<CheckCircle2 className="h-5 w-5" />
							</div>
						</div>
					</CardContent>
				</Card>
			</div>

			{successMessage ? (
				<div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900 text-sm dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
					<span>{successMessage}</span>
					<button
						type="button"
						onClick={() => setSuccessMessage("")}
						className="rounded-md p-1 text-emerald-700 transition hover:bg-emerald-100 hover:text-emerald-900 dark:text-emerald-200 dark:hover:bg-emerald-950"
						aria-label="Tutup pesan sukses"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
			) : null}

			{errorMessage ? (
				<div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800 text-sm dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
					<span>{errorMessage}</span>
					<button
						type="button"
						onClick={() => setErrorMessage("")}
						className="rounded-md p-1 text-red-700 transition hover:bg-red-100 hover:text-red-900 dark:text-red-200 dark:hover:bg-red-950"
						aria-label="Tutup pesan error"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
			) : null}

			{/* PANEL FILTER & PENCARIAN */}
			<Card className="border-emerald-200 bg-emerald-50/50 shadow-sm shadow-emerald-950/5 dark:border-emerald-900/60 dark:bg-emerald-950/15">
				<CardContent className="space-y-4 p-5">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div className="flex items-center gap-2">
							<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900">
								<Filter className="h-4 w-4" />
							</div>
							<div>
								<h3 className="font-semibold text-emerald-950 text-sm dark:text-emerald-50">
									Pencarian & filter
								</h3>
								<p className="text-emerald-900/65 text-xs dark:text-emerald-100/65">
									Saring antrean berdasarkan pasien, resep, status, dan periode.
								</p>
							</div>
						</div>
					</div>

					<div className="relative">
						<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600/70" />
						<Input
							value={orderListQuery}
							onChange={(event) => setOrderListQuery(event.target.value)}
							placeholder="Cari nama pasien, nomor RM, nomor resep..."
							maxLength={80}
							className={`${quietInputClass} h-10 pl-9`}
						/>
					</div>

					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
						<div className="space-y-1.5">
							<label
								className="text-xs font-medium text-slate-600 dark:text-slate-300"
								htmlFor="filterQueueView"
							>
								Tampilan data
							</label>
							<div className="relative">
								<ListFilter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600/70" />
								<select
									id="filterQueueView"
									value={queueView}
									onChange={(e) =>
										setQueueView(e.target.value as DispensingQueueView)
									}
									className={`${quietInputClass} h-10 w-full appearance-none rounded-md border pl-9 pr-3 text-slate-900 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:text-white`}
								>
									<option value="antrean">Antrean aktif</option>
									<option value="riwayat">
										Riwayat ({historyOrdersCount})
									</option>
									<option value="semua">Semua</option>
								</select>
							</div>
						</div>
						<div className="space-y-1.5">
							<label
								className="text-xs font-medium text-slate-600 dark:text-slate-300"
								htmlFor="filterTipeLayanan"
							>
								Tipe layanan
							</label>
							<div className="relative">
								<ClipboardList className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600/70" />
								<select
									id="filterTipeLayanan"
									value={filterTipeLayanan}
									onChange={(e) => setFilterTipeLayanan(e.target.value)}
									className={`${quietInputClass} h-10 w-full appearance-none rounded-md border pl-9 pr-3 text-slate-900 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:text-white`}
								>
									<option value="Semua">Semua layanan</option>
									<option value="Rawat Jalan">Rawat Jalan</option>
									<option value="Rawat Inap">Rawat Inap</option>
									<option value="UGD">UGD</option>
									<option value="CITO">CITO</option>
								</select>
							</div>
						</div>

						<div className="space-y-1.5">
							<label
								className="text-xs font-medium text-slate-600 dark:text-slate-300"
								htmlFor="filterStatusPeracikan"
							>
								Status peracikan
							</label>
							<div className="relative">
								<PackageCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600/70" />
								<select
									id="filterStatusPeracikan"
									value={filterStatusPeracikan}
									onChange={(e) => setFilterStatusPeracikan(e.target.value)}
									className={`${quietInputClass} h-10 w-full appearance-none rounded-md border pl-9 pr-3 text-slate-900 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:text-white`}
								>
									<option value="Semua">Semua status</option>
									<option value="Menunggu">Menunggu Validasi</option>
									<option value="Proses">Sedang Diracik</option>
									<option value="Selesai">Siap Diserahkan</option>
								</select>
							</div>
						</div>

						<div className="space-y-1.5">
							<label
								className="text-xs font-medium text-slate-600 dark:text-slate-300"
								htmlFor="filterTanggal"
							>
								Periode
							</label>
							<div className="relative">
								<CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600/70" />
								<select
									id="filterTanggal"
									value={filterTanggal}
									onChange={(e) => setFilterTanggal(e.target.value)}
									className={`${quietInputClass} h-10 w-full appearance-none rounded-md border pl-9 pr-3 text-slate-900 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:text-white`}
								>
									<option value="Hari ini">Hari ini</option>
									<option value="Kemarin">Kemarin</option>
									<option value="7 Hari Terakhir">7 hari terakhir</option>
									<option value="30 Hari Terakhir">30 hari terakhir</option>
								</select>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* TABEL ANTREAN RESEP */}
			<Card className="overflow-hidden border-emerald-200 bg-white shadow-sm shadow-emerald-950/5 dark:border-emerald-900/60 dark:bg-emerald-950/10">
				<CardHeader className="border-b border-emerald-200 bg-emerald-50/80 px-5 py-4 dark:border-emerald-900/60 dark:bg-emerald-950/25">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div className="flex items-start gap-3">
							<div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900">
								<ClipboardList className="h-4 w-4" />
							</div>
							<div>
								<CardTitle className="text-base font-semibold text-emerald-950 dark:text-emerald-50">
									Antrean dispensing resep
								</CardTitle>
								<CardDescription className="mt-1 text-emerald-900/65 text-xs dark:text-emerald-100/65">
									{getQueueViewLabel(queueView)} — satu baris per resep; beberapa
									obat ditampilkan bersama. Gunakan Kelola untuk edit atau
									batalkan peracikan.
								</CardDescription>
							</div>
						</div>
						<Badge className="w-fit border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
							{filteredPrescriptionGroups.length} resep ({filteredOrders.length}{" "}
							obat)
						</Badge>
					</div>
				</CardHeader>
				<CardContent className="px-0 pb-0">
					<div className="overflow-x-auto">
						<table className="w-full min-w-[920px] text-left text-sm">
							<thead className="border-b border-emerald-200 bg-emerald-100/70 dark:border-emerald-900/60 dark:bg-emerald-950/30">
								<tr>
									<th className="px-5 py-3 font-medium text-emerald-900 text-xs dark:text-emerald-100">
										Waktu
									</th>
									<th className="px-5 py-3 font-medium text-emerald-900 text-xs dark:text-emerald-100">
										Pasien
									</th>
									<th className="px-5 py-3 font-medium text-emerald-900 text-xs dark:text-emerald-100">
										No. resep
									</th>
									<th className="px-5 py-3 font-medium text-emerald-900 text-xs dark:text-emerald-100">
										Obat
									</th>
									<th className="px-5 py-3 font-medium text-emerald-900 text-xs dark:text-emerald-100">
										Peracikan
									</th>
									<th className="px-5 py-3 font-medium text-emerald-900 text-xs dark:text-emerald-100">
										Pembayaran
									</th>
									<th className="px-5 py-3 font-medium text-emerald-900 text-xs dark:text-emerald-100">
										Aksi
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-emerald-50 dark:divide-emerald-950/50">
								{isLoading ? (
									<tr>
										<td
											className="px-5 py-12 text-center text-slate-500 text-sm"
											colSpan={7}
										>
											<div className="flex flex-col items-center gap-3">
												<Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
												<div>
													<p className="font-medium text-slate-700 dark:text-slate-200">
														Memuat antrean resep
													</p>
													<p className="mt-1 text-slate-500 text-xs dark:text-slate-400">
														Mengambil data terbaru dari server.
													</p>
												</div>
											</div>
										</td>
									</tr>
								) : filteredPrescriptionGroups.length === 0 ? (
									<tr>
										<td
											className="px-5 py-12 text-center text-slate-500 text-sm"
											colSpan={7}
										>
											<div className="mx-auto flex max-w-sm flex-col items-center justify-center gap-3">
												<div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900">
													<FileText className="h-5 w-5" />
												</div>
												<div>
													<p className="font-medium text-slate-700 dark:text-slate-200">
														{isDashboardFilterActive
															? "Tidak ada resep yang cocok"
															: "Belum ada antrean resep"}
													</p>
													<p className="mt-1 text-slate-500 text-xs dark:text-slate-400">
														{isDashboardFilterActive
															? "Coba ubah kata kunci pencarian atau filter."
															: statistics.total === 0
																? "Tambahkan resep baru untuk memulai dispensing."
																: `Belum ada antrean pada periode ${periodSummaryLabel.toLowerCase()}.`}
													</p>
												</div>
											</div>
										</td>
									</tr>
								) : (
									filteredPrescriptionGroups.map((group) => {
										const primaryOrder = group.orders[0]!;
										const workflowSummary = getGroupWorkflowSummary(
											group.orders,
										);
										const groupPaymentStatus = getGroupPaymentStatus(
											group.orders,
										);
										const payment = paymentStatusBadge(groupPaymentStatus);
										const isGroupComplete = workflowSummary.type === "complete";
										const isGroupUpdating =
											isUpdatingWorkflow && updatingGroupKey === group.key;
										const isPaymentLunas = groupPaymentStatus === "lunas";
										const groupNextAction =
											workflowSummary.type === "single"
												? workflowSummary.nextAction
												: null;

										return (
											<tr
												key={group.key}
												className={
													isGroupComplete
														? "bg-emerald-50/35 dark:bg-emerald-950/15"
														: "bg-white transition hover:bg-emerald-50/35 dark:bg-transparent dark:hover:bg-emerald-950/10"
												}
											>
												<td className="px-5 py-4 align-top">
													<div className="space-y-2">
														<div className="text-slate-600 text-xs dark:text-slate-300">
															{new Date(group.createdAt).toLocaleString(
																"id-ID",
																{
																	day: "2-digit",
																	month: "2-digit",
																	year: "numeric",
																	hour: "2-digit",
																	minute: "2-digit",
																},
															)}
														</div>
														<Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
															{inferOrderServiceType(primaryOrder)}
														</Badge>
													</div>
												</td>
												<td className="px-5 py-4 align-top">
													<div className="space-y-1">
														<div className="font-medium text-slate-950 leading-tight dark:text-white">
															{group.patientName}
														</div>
														<div className="inline-flex rounded-md bg-emerald-50 px-2 py-1 font-mono text-emerald-700 text-xs ring-1 ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900">
															{group.nomorRM ?? "-"}
														</div>
													</div>
												</td>
												<td className="px-5 py-4 align-top">
													<div className="space-y-1">
														<div className="inline-flex rounded-md bg-emerald-50 px-2 py-1 font-mono text-emerald-800 text-xs ring-1 ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900">
															{group.nomorPeresepan}
														</div>
														<p className="text-emerald-800/80 text-[11px] dark:text-emerald-200/80">
															{group.orders.length} obat
														</p>
													</div>
												</td>
												<td className="px-5 py-4 align-top">
													<ul className="space-y-2">
														{group.orders.map((order) => (
															<li
																key={order.id}
																className="border-emerald-100 border-l-2 pl-2 dark:border-emerald-900"
															>
																<div className="font-medium text-slate-900 text-sm leading-tight dark:text-white">
																	{order.medicineName}
																</div>
																<div className="font-mono text-emerald-700 text-[11px] dark:text-emerald-300">
																	{order.nomorObat ?? "-"} · Qty{" "}
																	{order.quantity}
																</div>
															</li>
														))}
													</ul>
												</td>
												<td className="px-5 py-4 align-top">
													{workflowSummary.type === "single" ? (
														<Badge
															className={
																statusBadge(workflowSummary.status).className
															}
														>
															{statusBadge(workflowSummary.status).text}
														</Badge>
													) : workflowSummary.type === "mixed" ? (
														<div className="space-y-1">
															<Badge className="border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
																{group.orders.length} obat · status campuran
															</Badge>
															<p className="text-slate-500 text-[11px] dark:text-slate-400">
																Kelola per obat
															</p>
														</div>
													) : (
														<Badge className="border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
															Selesai
														</Badge>
													)}
												</td>
												<td className="px-5 py-4 align-top">
													<Badge className={payment.className}>
														{payment.text}
													</Badge>
												</td>
												<td className="px-5 py-4 align-top">
													<div className="flex flex-wrap items-center gap-2">
														{groupNextAction ? (
															<Button
																type="button"
																size="sm"
																className={primaryActionClass}
																disabled={
																	isGroupUpdating ||
																	isSubmitting ||
																	isManualSubmitting ||
																	isLookupLoading ||
																	isGeneratingLabel ||
																	(!isPaymentLunas &&
																		groupNextAction.target ===
																			"sedang_diracik")
																}
																onClick={() =>
																	void handleUpdateWorkflowForGroup(
																		group,
																		groupNextAction.target,
																	)
																}
															>
																{isGroupUpdating ? (
																	<>
																		<Loader2 className="h-3.5 w-3.5 animate-spin" />
																		Proses
																	</>
																) : !isPaymentLunas &&
																	groupNextAction.target ===
																		"sedang_diracik" ? (
																	<>
																		<Clock3 className="h-3.5 w-3.5" />
																		Tunggu bayar
																	</>
																) : (
																	<>
																		<Check className="h-3.5 w-3.5" />
																		{groupNextAction.label}
																		{group.orders.length > 1
																			? ` (${group.orders.length})`
																			: ""}
																	</>
																)}
															</Button>
														) : isGroupComplete ? (
															<span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1.5 text-emerald-700 text-xs font-medium ring-1 ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900">
																<CheckCircle2 className="h-3.5 w-3.5" />
																Selesai
															</span>
														) : null}
														<Button
															type="button"
															size="sm"
															variant="outline"
															className={secondaryActionClass}
															disabled={
																isGroupUpdating ||
																isSubmitting ||
																isManualSubmitting ||
																isLookupLoading ||
																isGeneratingLabel ||
																isSavingOrderDetails ||
																isCancelingOrder
															}
															onClick={() =>
																handleOpenPrescriptionGroup(group)
															}
														>
															<Pencil className="h-3.5 w-3.5" />
															Kelola
														</Button>
													</div>
												</td>
											</tr>
										);
									})
								)}
							</tbody>
						</table>
					</div>
				</CardContent>
			</Card>

			<Card className={cardSurfaceClass}>
				<CardHeader className="border-b border-emerald-100/80 pb-4 dark:border-emerald-900/50">
					<div className="flex items-start gap-3">
						<div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900">
							<Search className="h-4 w-4" />
						</div>
						<div>
							<CardTitle className="text-base font-semibold text-slate-950 dark:text-white">
								Cari resep untuk dispensing
							</CardTitle>
							<CardDescription className="mt-1 text-xs">
								Input nomor RM dan nomor peresepan untuk menarik data pasien dan
								daftar obat dari resep dokter.
							</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent className="pt-5">
					<form
						className="grid gap-3 md:grid-cols-2"
						onSubmit={handleLookupPrescription}
					>
						<div className="space-y-1.5">
							<label
								className="font-medium text-slate-700 text-sm dark:text-slate-200"
								htmlFor="nomorRM"
							>
								Nomor RM pasien
							</label>
							<Input
								ref={nomorRMRef}
								id="nomorRM"
								value={nomorRM}
								onChange={(event) =>
									setNomorRM(event.target.value.toUpperCase())
								}
								placeholder="Contoh: RM-0001"
								maxLength={32}
								required
								className={quietInputClass}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										const nextInput = document.getElementById("nomorPeresepan");
										nextInput?.focus();
									}
								}}
							/>
						</div>

						<div className="space-y-1.5">
							<label
								className="font-medium text-slate-700 text-sm dark:text-slate-200"
								htmlFor="nomorPeresepan"
							>
								Nomor peresepan dokter
							</label>
							<Input
								id="nomorPeresepan"
								value={nomorPeresepan}
								onChange={(event) =>
									setNomorPeresepan(event.target.value.toUpperCase())
								}
								placeholder="Contoh: RSP-2026-0001"
								maxLength={40}
								required
								className={quietInputClass}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										void handleLookupPrescription(
											e as unknown as React.FormEvent<HTMLFormElement>,
										);
									}
								}}
							/>
						</div>

						<div className="flex flex-wrap gap-2 md:col-span-2">
							<Button
								type="submit"
								className={primaryActionClass}
								disabled={isLookupLoading || isManualSubmitting}
							>
								{isLookupLoading ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<Search className="h-4 w-4" />
								)}
								{isLookupLoading ? "Mencari" : "Cari resep"}
							</Button>
							<Button
								type="button"
								variant="outline"
								className={secondaryActionClass}
								onClick={resetLookup}
								disabled={isLookupLoading || isSubmitting || isManualSubmitting}
							>
								<RotateCcw className="h-4 w-4" />
								Reset
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>

			{lookupPrescription ? (
				<Card className={cardSurfaceClass}>
					<CardHeader className="border-b border-emerald-100/80 pb-4 dark:border-emerald-900/50">
						<CardTitle className="text-base font-semibold text-slate-950 dark:text-white">
							Data resep tervalidasi
						</CardTitle>
						<CardDescription>
							Nama pasien, nomor obat, nama obat, dan keterangan obat
							ditampilkan otomatis dari resep dokter.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div
							className={`${softPanelClass} grid gap-3 p-4 text-sm md:grid-cols-2`}
						>
							<div>
								<p className="text-muted-foreground">Nomor RM</p>
								<p className="font-medium">{lookupPrescription.nomorRM}</p>
							</div>
							<div>
								<p className="text-muted-foreground">Nomor Peresepan</p>
								<p className="font-medium">
									{lookupPrescription.nomorPeresepan}
								</p>
							</div>
							<div>
								<p className="text-muted-foreground">Nama Pasien</p>
								<p className="font-medium">{lookupPrescription.patientName}</p>
							</div>
							<div>
								<p className="text-muted-foreground">Dokter</p>
								<p className="font-medium">{lookupPrescription.doctorName}</p>
							</div>
						</div>

						<div className="overflow-x-auto rounded-lg border border-emerald-100 dark:border-emerald-900/60">
							<table className="w-full text-left text-sm">
								<thead className="bg-emerald-50/70 dark:bg-emerald-950/20">
									<tr>
										<th className="px-3 py-2">No. Obat</th>
										<th className="px-3 py-2">Nama Obat</th>
										<th className="px-3 py-2">Keterangan Obat</th>
										<th className="px-3 py-2">Jumlah</th>
										<th className="px-3 py-2">Aksi</th>
									</tr>
								</thead>
								<tbody>
									{lookupPrescription.items.length === 0 ? (
										<tr className="border-t">
											<td
												className="px-3 py-6 text-center text-muted-foreground text-sm"
												colSpan={5}
											>
												Tidak ada item obat pada resep ini.
											</td>
										</tr>
									) : (
										lookupPrescription.items.map((item) => {
											const isProcessingCurrent =
												isSubmitting && processingNomorObat === item.nomorObat;

											return (
												<tr
													key={item.nomorObat}
													className="border-t border-emerald-50 transition hover:bg-emerald-50/40 dark:border-emerald-950/50 dark:hover:bg-emerald-950/10"
												>
													<td className="px-3 py-2">{item.nomorObat}</td>
													<td className="px-3 py-2">{item.medicineName}</td>
													<td className="px-3 py-2">{item.keteranganObat}</td>
													<td className="px-3 py-2">{item.quantity}</td>
													<td className="px-3 py-2">
														<Button
															type="button"
															size="sm"
															className={primaryActionClass}
															disabled={isSubmitting || isManualSubmitting}
															onClick={() =>
																void handleCreateOrder(item.nomorObat)
															}
														>
															{isProcessingCurrent ? (
																<span className="flex items-center gap-2">
																	<Loader2 className="h-3.5 w-3.5 animate-spin" />
																	Memproses
																</span>
															) : (
																<>
																	<PackageCheck className="h-3.5 w-3.5" />
																	Proses dispensing
																</>
															)}
														</Button>
													</td>
												</tr>
											);
										})
									)}
								</tbody>
							</table>
						</div>
					</CardContent>
				</Card>
			) : null}

			<Dialog
				open={isCreateDialogOpen}
				onOpenChange={(open) => {
					setIsCreateDialogOpen(open);
					if (!open) {
						setShowPatientSuggestions(false);
						setShowPrescriptionSuggestions(false);
						setActiveMedicineObatId(null);
					}
				}}
			>
				<DialogContent
					scrollResetKey={
						isCreateDialogOpen ? "create-open" : "create-closed"
					}
					className={cn(
						dialogTallLayoutClassName,
						"w-full max-w-4xl border-emerald-100 bg-white dark:border-emerald-900/60 dark:bg-slate-950",
					)}
				>
					<DialogHeader className="shrink-0 border-emerald-100 border-b bg-white px-6 py-4 dark:border-emerald-900/60 dark:bg-slate-950">
						<DialogTitle className="text-slate-950 dark:text-white">
							Tambah resep dan dispensing baru
						</DialogTitle>
						<DialogDescription className="text-slate-600">
							Ketik untuk melihat rekomendasi pasien, resep, obat, dan dosis.
						</DialogDescription>
					</DialogHeader>

					<DialogScrollBody className="space-y-4 px-6 py-4 [&_input]:border-emerald-100 [&_input]:bg-white [&_input]:text-slate-900 [&_input]:placeholder:text-slate-400 [&_input]:focus-visible:border-emerald-500 [&_input]:focus-visible:ring-emerald-500/20 dark:[&_input]:border-emerald-900/60 dark:[&_input]:bg-emerald-950/10 dark:[&_input]:text-white">
						{/* Segmented Control for Mode Selection */}
						<div className="grid gap-2 rounded-lg bg-emerald-50/60 p-1 ring-1 ring-emerald-100 sm:grid-cols-2 dark:bg-emerald-950/20 dark:ring-emerald-900/60">
							<button
								type="button"
								onClick={() => setManualMode("from_prescription")}
								disabled={
									isManualSubmitting ||
									isManualLookupLoading ||
									isLookupLoading ||
									isSubmitting
								}
								className={`flex items-center justify-center gap-2 rounded-md px-4 py-2.5 font-medium text-sm transition ${
									!isManualPrescriptionMode
										? "bg-white text-emerald-800 shadow-sm ring-1 ring-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-100 dark:ring-emerald-900"
										: "text-slate-600 hover:bg-white/70 hover:text-emerald-800 dark:text-slate-300 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-100"
								} ${isManualSubmitting || isManualLookupLoading || isLookupLoading || isSubmitting ? "cursor-not-allowed opacity-50" : ""}`}
							>
								<ClipboardList className="h-4 w-4" />
								Resep Dokter
							</button>
							<button
								type="button"
								onClick={() => setManualMode("manual_prescription")}
								disabled={
									isManualSubmitting ||
									isManualLookupLoading ||
									isLookupLoading ||
									isSubmitting
								}
								className={`flex items-center justify-center gap-2 rounded-md px-4 py-2.5 font-medium text-sm transition ${
									isManualPrescriptionMode
										? "bg-white text-emerald-800 shadow-sm ring-1 ring-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-100 dark:ring-emerald-900"
										: "text-slate-600 hover:bg-white/70 hover:text-emerald-800 dark:text-slate-300 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-100"
								} ${isManualSubmitting || isManualLookupLoading || isLookupLoading || isSubmitting ? "cursor-not-allowed opacity-50" : ""}`}
							>
								<FilePlus2 className="h-4 w-4" />
								Manual
							</button>
						</div>

						{/* Helper Text */}
						<p className="text-slate-600 text-xs">
							{isManualPrescriptionMode
								? "Input manual: isi data pasien, dokter, dan obat secara langsung"
								: "Resep dokter: tarik data otomatis dari nomor peresepan"}
						</p>

						<form
							id="create-prescription-form"
							className="space-y-4"
							onSubmit={handleCreateManualOrder}
						>
							{/* Section 1: Info Dasar dengan Layout Grid 2 Kolom */}
							<div className="space-y-3">
								<h4 className="font-semibold text-slate-900 text-sm">
									Informasi Dasar
								</h4>
								<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
									{/* Baris 1: Nomor RM & Nomor Peresepan */}
									<div className="space-y-1">
										<label
											className="font-medium text-slate-800 text-sm"
											htmlFor="manualNomorRM"
										>
											Nomor RM (Opsional)
										</label>
										<Input
											ref={manualNomorRMRef}
											id="manualNomorRM"
											value={manualNomorRM}
											onChange={(event) =>
												setManualNomorRM(event.target.value.toUpperCase())
											}
											placeholder="Contoh: RM-0034"
											maxLength={32}
											onKeyDown={(e) => {
												if (e.key === "Enter") {
													e.preventDefault();
													const nextInput = document.getElementById(
														"manualNomorPeresepan",
													);
													nextInput?.focus();
												}
											}}
										/>
									</div>

									<div className="relative space-y-1">
										<label
											className="font-medium text-slate-800 text-sm"
											htmlFor="manualPatientName"
										>
											Nama Pasien
										</label>
										<Input
											id="manualPatientName"
											value={manualPatientName}
											placeholder={
												isManualPrescriptionMode
													? "Ketik nama pasien..."
													: "Terisi otomatis dari resep"
											}
											readOnly={!isManualPrescriptionMode}
											onChange={(event) => {
												setManualPatientName(event.target.value);
												if (isManualPrescriptionMode) {
													setShowPatientSuggestions(true);
													setHighlightedPatientIdx(0);
												}
											}}
											onFocus={() => {
												if (isManualPrescriptionMode) {
													setShowPatientSuggestions(true);
												}
											}}
											onBlur={() => {
												window.setTimeout(
													() => setShowPatientSuggestions(false),
													150,
												);
											}}
											className={
												!isManualPrescriptionMode
													? "bg-slate-100 text-slate-800"
													: undefined
											}
										/>
										{isManualPrescriptionMode &&
											showPatientSuggestions &&
											patientNameSuggestions.length > 0 && (
												<div className="absolute top-full right-0 left-0 z-50 mt-1">
													<SuggestionPanel
														options={patientNameSuggestions.map(
															(patient) => ({
																id: patient.userId,
																primary: patient.name,
																secondary: patient.nomorRM
																	? `RM ${patient.nomorRM}`
																	: undefined,
																meta: patient.email,
															}),
														)}
														highlightedIndex={highlightedPatientIdx}
														onHighlight={setHighlightedPatientIdx}
														onSelect={(option) => {
															const patient = patientNameSuggestions.find(
																(item) => item.userId === option.id,
															);
															if (patient) {
																handleSelectPatientSuggestion(patient);
															}
														}}
													/>
												</div>
											)}
									</div>

									<div className="relative space-y-1 md:col-span-2">
										<label
											className="font-medium text-slate-800 text-sm"
											htmlFor="manualNomorPeresepan"
										>
											Nomor Peresepan
										</label>
										<Input
											id="manualNomorPeresepan"
											value={manualNomorPeresepan}
											onChange={(event) => {
												setManualNomorPeresepan(
													event.target.value.toUpperCase(),
												);
												setShowPrescriptionSuggestions(true);
												setHighlightedPrescriptionIdx(0);
											}}
											onFocus={() => setShowPrescriptionSuggestions(true)}
											onBlur={() => {
												window.setTimeout(
													() => setShowPrescriptionSuggestions(false),
													150,
												);
												if (
													!isManualPrescriptionMode &&
													manualNomorPeresepan.trim().length >= 5
												) {
													void handleManualLookupPrescription();
												}
											}}
											placeholder="Ketik nomor resep..."
											maxLength={40}
											required
											onKeyDown={(e) => {
												if (e.key === "Enter") {
													e.preventDefault();
													if (!isManualPrescriptionMode) {
														void handleManualLookupPrescription();
													} else {
														document
															.getElementById("manualDoctorName")
															?.focus();
													}
												}
											}}
										/>
										{showPrescriptionSuggestions &&
											prescriptionNumberSuggestions.length > 0 && (
												<div className="absolute top-full right-0 left-0 z-50 mt-1">
													<SuggestionPanel
														options={prescriptionNumberSuggestions.map(
															(prescription) => ({
																id: prescription.id,
																primary: prescription.nomorPeresepan,
																secondary: prescription.patientName,
																meta: `RM ${prescription.nomorRM} · ${prescription.doctorName}`,
															}),
														)}
														isLoading={isPrescriptionCatalogLoading}
														highlightedIndex={highlightedPrescriptionIdx}
														onHighlight={setHighlightedPrescriptionIdx}
														onSelect={(option) => {
															const prescription =
																prescriptionNumberSuggestions.find(
																	(item) => item.id === option.id,
																);
															if (prescription) {
																handleSelectPrescriptionSuggestion(
																	prescription,
																);
															}
														}}
														emptyMessage="Belum ada resep yang cocok."
													/>
												</div>
											)}
									</div>

									{/* Baris 3: Nama Dokter */}
									<div className="space-y-1 md:col-span-2">
										<label
											className="font-medium text-slate-800 text-sm"
											htmlFor="manualDoctorName"
										>
											Nama Dokter
										</label>
										<Input
											id="manualDoctorName"
											value={manualDoctorName}
											placeholder={
												isManualPrescriptionMode
													? "Contoh: dr. Budi"
													: "Terisi otomatis dari resep"
											}
											maxLength={80}
											readOnly={!isManualPrescriptionMode}
											onChange={(event) =>
												setManualDoctorName(event.target.value)
											}
											className={
												!isManualPrescriptionMode
													? "bg-slate-100 text-slate-800"
													: undefined
											}
										/>
									</div>
								</div>

								{!isManualPrescriptionMode && (
									<div className="flex flex-wrap items-center gap-2 pt-1">
										<Button
											type="button"
											size="sm"
											className={primaryActionClass}
											onClick={() => void handleManualLookupPrescription()}
											disabled={
												isManualLookupLoading ||
												isManualSubmitting ||
												isSubmitting ||
												isLookupLoading
											}
										>
											{isManualLookupLoading ? (
												<Loader2 className="h-4 w-4 animate-spin" />
											) : (
												<Search className="h-4 w-4" />
											)}
											{isManualLookupLoading
												? "Mencari resep..."
												: "Tarik data resep"}
										</Button>
										<p className="text-slate-500 text-xs">
											Rekomendasi nomor resep muncul saat Anda mengetik.
										</p>
									</div>
								)}

								{manualLookupPrescription ? (
									<div
										className={`${softPanelClass} flex items-start gap-2 px-3 py-2.5 text-sm`}
									>
										<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
										<div>
											<p className="font-medium text-emerald-900 dark:text-emerald-100">
												Resep ditemukan — {manualLookupPrescription.patientName}
											</p>
											<p className="text-slate-600 text-xs dark:text-slate-300">
												{manualLookupPrescription.items.length} item obat
												sudah dimuat ke daftar di bawah.
											</p>
										</div>
									</div>
								) : null}

								{isManualPrescriptionMode && (
									<div
										className={`${softPanelClass} px-3 py-2 text-slate-700 text-xs dark:text-slate-200`}
									>
										Mode manual: isi semua data secara manual. Sistem akan buat
										resep + order sekaligus.
									</div>
								)}
							</div>

							{/* Section 2: Daftar Obat dengan Dynamic Array */}
							<div className="space-y-3 border-emerald-100 border-t pt-4">
								<div className="flex items-center justify-between">
									<h4 className="font-semibold text-slate-900 text-sm">
										Daftar Obat
									</h4>
									<Button
										type="button"
										size="sm"
										variant="outline"
										className={secondaryActionClass}
										onClick={handleAddMedication}
										disabled={isManualSubmitting || isManualLookupLoading}
									>
										<Plus className="h-4 w-4" />
										Tambah obat
									</Button>
								</div>

								<div className="space-y-4">
									{obatList.map((obat, idx) => (
										<div
											key={obat.id}
											className="space-y-3 rounded-lg border border-emerald-100 bg-white p-4 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/10"
										>
											<div className="mb-2 flex items-center justify-between">
												<span className="font-semibold text-emerald-800 text-xs">
													Obat #{idx + 1}
												</span>
												{obatList.length > 1 && (
													<Button
														type="button"
														size="sm"
														variant="ghost"
														onClick={() => handleRemoveMedication(obat.id)}
														disabled={isManualSubmitting}
														className="h-7 w-7 p-0 text-slate-500 hover:bg-red-50 hover:text-red-600"
														aria-label="Hapus obat"
													>
														<Trash2 className="h-4 w-4" />
													</Button>
												)}
											</div>

											<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
												<div className="relative space-y-1.5 md:col-span-2">
													<label
														className="font-medium text-slate-800 text-sm"
														htmlFor={`medicineName-${obat.id}`}
													>
														Nama Obat
													</label>
													<Input
														id={`medicineName-${obat.id}`}
														value={obat.medicineName}
														onChange={(event) =>
															handleMedicineNameChange(idx, event.target.value)
														}
														onFocus={() => {
															setActiveMedicineObatId(obat.id);
															if (obat.medicineName.trim().length >= 2) {
																scheduleMedicineSearch(
																	obat.id,
																	obat.medicineName,
																);
															}
														}}
														onBlur={() => {
															tryAutoMatchMedicineOnBlur(idx);
															window.setTimeout(() => {
																if (activeMedicineObatId === obat.id) {
																	setActiveMedicineObatId(null);
																}
															}, 150);
														}}
														onKeyDown={(event) =>
															handleMedicineNameKeyDown(idx, event)
														}
														placeholder="Ketik minimal 2 huruf..."
														maxLength={120}
														autoComplete="off"
													/>
													{activeMedicineObatId === obat.id && (
														<div className="mt-1.5">
															<SuggestionPanel
																options={dedupeMedicineSuggestions(
																	medicineSuggestionsByObatId[obat.id] ?? [],
																).map((medicine) => ({
																	id: medicine.id,
																	primary: medicine.nama,
																	secondary: medicine.nomorObat,
																	meta: `${medicine.stok} ${medicine.satuan} · ${stockStatusLabel(medicine.status)}`,
																}))}
																isLoading={
																	medicineSuggestionLoadingId === obat.id
																}
																highlightedIndex={highlightedMedicineIdx}
																onHighlight={setHighlightedMedicineIdx}
																onSelect={(option) => {
																	const medicine = (
																		medicineSuggestionsByObatId[obat.id] ?? []
																	).find((item) => item.id === option.id);
																	if (medicine) {
																		handleSelectMedicineFromSuggestion(
																			idx,
																			medicine,
																		);
																	}
																}}
																emptyMessage={
																	obat.medicineName.trim().length < 2
																		? "Ketik minimal 2 huruf untuk rekomendasi obat."
																		: "Obat tidak ditemukan di stok/katalog."
																}
															/>
														</div>
													)}
												</div>

												{/* Nomor Obat & Jumlah */}
												<div className="space-y-1">
													<label
														className="font-medium text-slate-800 text-sm"
														htmlFor={`nomorObat-${obat.id}`}
													>
														Nomor Obat
													</label>
													<Input
														id={`nomorObat-${obat.id}`}
														value={obat.nomorObat}
														placeholder={
															obat.medicineName.trim()
																? "Terisi otomatis dari nama obat"
																: "Pilih atau ketik nama obat dulu"
														}
														maxLength={32}
														readOnly
														tabIndex={-1}
														className="bg-slate-100 font-mono text-slate-800"
													/>
												</div>

												<div className="space-y-1">
													<label
														className="font-medium text-slate-800 text-sm"
														htmlFor={`quantity-${obat.id}`}
													>
														Jumlah
													</label>
													<Input
														id={`quantity-${obat.id}`}
														type="number"
														min={1}
														max={500}
														value={obat.quantity}
														onChange={(event) =>
															handleUpdateMedication(
																obat.id,
																"quantity",
																Number.parseInt(event.target.value, 10) || 1,
															)
														}
													/>
												</div>
											</div>

											<div className="space-y-2 md:col-span-2">
												<label
													className="font-medium text-slate-800 text-sm"
													htmlFor={`dosage-${obat.id}`}
												>
													Dosis
												</label>
												<Input
													id={`dosage-${obat.id}`}
													value={obat.dosage}
													onChange={(event) =>
														handleUpdateMedication(
															obat.id,
															"dosage",
															event.target.value,
														)
													}
													placeholder="Ketik atau pilih rekomendasi dosis"
													maxLength={120}
												/>
												<div className="space-y-1.5">
													<p className="flex items-center gap-1 text-slate-500 text-[11px]">
														<Sparkles className="h-3 w-3 text-emerald-600" />
														Rekomendasi dosis
													</p>
													<div className="flex flex-wrap gap-1.5">
														{filterDosageSuggestions(obat.dosage).map(
															(dosage) => (
																<button
																	key={dosage}
																	type="button"
																	onClick={() =>
																		handleApplyQuickDosage(idx, dosage)
																	}
																	className={`inline-flex items-center rounded-full border px-2.5 py-1 font-medium text-xs transition ${
																		obat.dosage === dosage
																			? "border-emerald-500 bg-emerald-600 text-white"
																			: "border-emerald-100 bg-emerald-50/60 text-emerald-800 hover:border-emerald-200 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
																	}`}
																>
																	{dosage}
																</button>
															),
														)}
													</div>
												</div>
											</div>
										</div>
									))}
								</div>
							</div>

						</form>
					</DialogScrollBody>

					<div className="flex shrink-0 flex-wrap gap-2 border-emerald-100 border-t bg-emerald-50/95 px-6 py-4 dark:border-emerald-900/60 dark:bg-emerald-950/90">
						<Button
							type="submit"
							form="create-prescription-form"
							className={primaryActionClass}
							disabled={
								isManualSubmitting ||
								isManualLookupLoading ||
								isSubmitting ||
								isLookupLoading
							}
						>
							{isManualSubmitting
								? "Menyimpan..."
								: isManualPrescriptionMode
									? "Buat resep + dispensing"
									: "Tambah dispensing"}
						</Button>
						<Button
							type="button"
							variant="outline"
							className={secondaryActionClass}
							disabled={isManualSubmitting || isManualLookupLoading}
							onClick={resetManualForm}
						>
							Reset
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			<Dialog
				open={isHistoryDetailOpen}
				onOpenChange={(open) => {
					setIsHistoryDetailOpen(open);
					if (!open) {
						setIsEditResepOpen(false);
						clearMedicineSuggestions(EDIT_MEDICINE_SUGGESTION_ID);
						if (activeMedicineObatId === EDIT_MEDICINE_SUGGESTION_ID) {
							setActiveMedicineObatId(null);
						}
					}
				}}
			>
				<DialogContent
					scrollResetKey={
						isHistoryDetailOpen && selectedHistoryOrder
							? `kelola-${selectedHistoryOrder.id}`
							: "kelola-closed"
					}
					className={cn(
						dialogTallLayoutClassName,
						"w-full max-w-2xl border-emerald-200 bg-white shadow-2xl shadow-emerald-950/20 dark:border-emerald-900/70 dark:bg-slate-950",
					)}
				>
					<DialogHeader className="shrink-0 border-b border-emerald-200 bg-emerald-50 px-5 py-4 dark:border-emerald-900/70 dark:bg-emerald-950/25">
						<DialogTitle className="flex items-center gap-2 text-emerald-950 dark:text-emerald-50">
							<Pencil className="h-5 w-5" />
							Kelola dispensing
						</DialogTitle>
						<DialogDescription className="text-emerald-900/70 dark:text-emerald-100/70">
							Detail order, batalkan peresepan, proses peracikan, dan cetak label.
							Gunakan Edit resep untuk mengubah data obat.
						</DialogDescription>
					</DialogHeader>
					{selectedHistoryOrder ? (
						<DialogScrollBody
							ref={kelolaDialogScrollRef}
							className="space-y-4 p-5 text-sm"
						>
							<span
								id="kelola-dialog-scroll-top"
								tabIndex={-1}
								className="sr-only"
								aria-hidden
							>
								Atas dialog kelola
							</span>
							<div className="grid grid-cols-1 gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 md:grid-cols-2 dark:border-emerald-900/60 dark:bg-emerald-950/20">
								<div>
									<p className="text-muted-foreground text-xs">ID order</p>
									<p className="font-mono font-medium text-xs">
										{selectedHistoryOrder.id}
									</p>
								</div>
								<div>
									<p className="text-muted-foreground text-xs">Tipe layanan</p>
									<p className="font-medium">
										{inferOrderServiceType(selectedHistoryOrder)}
									</p>
								</div>
								<div>
									<p className="text-muted-foreground text-xs">Nama pasien</p>
									<p className="font-medium">
										{selectedHistoryOrder.patientName}
									</p>
								</div>
								<div>
									<p className="text-muted-foreground text-xs">Nomor RM</p>
									<p className="font-mono font-medium">
										{selectedHistoryOrder.nomorRM ?? "-"}
									</p>
								</div>
								<div>
									<p className="text-muted-foreground text-xs">Nomor peresepan</p>
									<p className="font-mono font-medium">
										{selectedHistoryOrder.nomorPeresepan ?? "-"}
									</p>
								</div>
								<div>
									<p className="text-muted-foreground text-xs">Nomor obat</p>
									<p className="font-mono font-medium">
										{selectedHistoryOrder.nomorObat ?? "-"}
									</p>
								</div>
								<div className="md:col-span-2">
									<p className="text-muted-foreground text-xs">Nama obat</p>
									<p className="font-medium">
										{selectedHistoryOrder.medicineName}
									</p>
								</div>
								<div>
									<p className="text-muted-foreground text-xs">Jumlah</p>
									<p className="font-medium">{selectedHistoryOrder.quantity}</p>
								</div>
								<div>
									<p className="text-muted-foreground text-xs">Dosis</p>
									<p className="font-medium">{selectedHistoryOrder.dosage}</p>
								</div>
								<div>
									<p className="text-muted-foreground text-xs">
										Status peracikan
									</p>
									{selectedHistoryWorkflowBadge ? (
										<Badge className={selectedHistoryWorkflowBadge.className}>
											{selectedHistoryWorkflowBadge.text}
										</Badge>
									) : null}
								</div>
								<div>
									<p className="text-muted-foreground text-xs">
										Status pembayaran
									</p>
									{selectedHistoryPaymentBadge ? (
										<Badge className={selectedHistoryPaymentBadge.className}>
											{selectedHistoryPaymentBadge.text}
										</Badge>
									) : null}
								</div>
								<div>
									<p className="text-muted-foreground text-xs">Waktu dibuat</p>
									<p className="font-medium">
										{new Date(selectedHistoryOrder.createdAt).toLocaleString(
											"id-ID",
										)}
									</p>
								</div>
								{selectedHistoryOrder.updatedAt ? (
									<div>
										<p className="text-muted-foreground text-xs">
											Terakhir diperbarui
										</p>
										<p className="font-medium">
											{new Date(
												selectedHistoryOrder.updatedAt,
											).toLocaleString("id-ID")}
										</p>
									</div>
								) : null}
							</div>

							<div className="space-y-2">
								<p className="font-semibold text-slate-800 text-xs uppercase tracking-wide dark:text-slate-200">
									Alur peracikan
								</p>
								<div className="flex flex-wrap gap-2">
									{workflowTimelineSteps.map((step, index) => {
										const isActive = index === activeWorkflowStepIndex;
										const isDone = index < activeWorkflowStepIndex;
										return (
											<div
												key={step.key}
												className={`rounded-full border px-3 py-1 text-xs font-medium ${
													isActive
														? "border-emerald-500 bg-emerald-600 text-white"
														: isDone
															? "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100"
															: "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
												}`}
											>
												{step.label}
											</div>
										);
									})}
								</div>
							</div>

							{relatedPrescriptionOrders.length > 0 ? (
								<div className="space-y-2">
									<p className="font-semibold text-slate-800 text-xs uppercase tracking-wide dark:text-slate-200">
										Daftar obat dalam resep {selectedHistoryOrder.nomorPeresepan}{" "}
										({relatedPrescriptionOrders.length})
									</p>
									<div className="max-h-36 space-y-1.5 overflow-y-auto rounded-lg border border-emerald-100 p-2 dark:border-emerald-900/60">
										{relatedPrescriptionOrders.map((item) => {
											const itemStatus = resolveWorkflowStatus(item);
											const itemBadge = statusBadge(itemStatus);
											const isCurrent = item.id === selectedHistoryOrder.id;
											return (
												<button
													key={item.id}
													type="button"
													tabIndex={0}
													onClick={() => {
														setSelectedHistoryOrder(item);
														resetManageOrderForm(item);
														window.requestAnimationFrame(() => {
															kelolaDialogScrollRef.current?.scrollTo({
																top: 0,
																left: 0,
															});
														});
													}}
													className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left transition ${
														isCurrent
															? "bg-emerald-100 ring-1 ring-emerald-300 dark:bg-emerald-950/50 dark:ring-emerald-800"
															: "hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
													}`}
												>
													<div className="min-w-0">
														<p className="truncate font-medium text-xs">
															{item.medicineName}
														</p>
														<p className="text-muted-foreground text-[11px]">
															{new Date(item.createdAt).toLocaleString(
																"id-ID",
															)}
														</p>
													</div>
													<Badge className={itemBadge.className}>
														{itemBadge.text}
													</Badge>
												</button>
											);
										})}
									</div>
								</div>
							) : null}

							{canManageActiveOrder ? (
								<div
									className={`${softPanelClass} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between`}
								>
									<div className="min-w-0">
										<p className="font-semibold text-emerald-900 text-sm dark:text-emerald-100">
											Data obat pada order ini
										</p>
										<p className="mt-1 truncate font-medium text-slate-800 text-sm dark:text-slate-100">
											{selectedHistoryOrder.medicineName}
										</p>
										<p className="text-muted-foreground text-xs">
											{selectedHistoryOrder.nomorObat ?? "-"} · jumlah{" "}
											{selectedHistoryOrder.quantity} · {selectedHistoryOrder.dosage}
										</p>
									</div>
									<Button
										type="button"
										size="sm"
										variant="outline"
										className={`${secondaryActionClass} shrink-0`}
										disabled={
											isSavingOrderDetails ||
											isCancelingOrder ||
											isSelectedHistoryUpdating
										}
										onClick={handleOpenEditResepDialog}
									>
										<Pencil className="h-4 w-4" />
										Edit resep
									</Button>
								</div>
							) : null}

							{canManageActiveOrder ? (
								<div className="space-y-3 rounded-lg border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-900/60 dark:bg-rose-950/20">
									<p className="font-semibold text-rose-900 text-sm dark:text-rose-100">
										Batalkan peracikan
									</p>
									<p className="text-rose-900/80 text-xs dark:text-rose-100/80">
										{getGroupPaymentStatus(relatedPrescriptionOrders) === "lunas"
											? "Jika pembayaran lunas, dana pasien dikembalikan otomatis (refund) sesuai jumlah obat yang dibatalkan."
											: "Peracikan yang dibatalkan tidak akan diproses lebih lanjut."}
									</p>
									<div className="space-y-1.5">
										<label
											className="text-xs font-medium text-slate-600 dark:text-slate-300"
											htmlFor="cancelReason"
										>
											Alasan pembatalan (opsional)
										</label>
										<Input
											id="cancelReason"
											value={cancelReason}
											onChange={(event) => setCancelReason(event.target.value)}
											placeholder="Contoh: permintaan pasien / salah input obat"
											className={quietInputClass}
										/>
									</div>
									<div className="flex flex-wrap gap-2">
										{relatedPrescriptionOrders.length > 1 ? (
											<Button
												type="button"
												size="sm"
												variant="outline"
												className="border-rose-300 bg-white text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-100"
												disabled={
													isCancelingOrder ||
													isSavingOrderDetails ||
													isSelectedHistoryUpdating
												}
												onClick={() => void handleCancelEntirePrescription()}
											>
												{isCancelingOrder ? (
													<Loader2 className="h-4 w-4 animate-spin" />
												) : (
													<Ban className="h-4 w-4" />
												)}
												Batalkan seluruh resep
												{getGroupPaymentStatus(relatedPrescriptionOrders) ===
												"lunas"
													? " & refund"
													: ""}
											</Button>
										) : null}
										<Button
											type="button"
											size="sm"
											variant="outline"
											className="border-rose-300 bg-white text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-100"
											disabled={
												isCancelingOrder ||
												isSavingOrderDetails ||
												isSelectedHistoryUpdating
											}
											onClick={() => void handleCancelDispensingOrder()}
										>
											{isCancelingOrder ? (
												<Loader2 className="h-4 w-4 animate-spin" />
											) : (
												<Ban className="h-4 w-4" />
											)}
											{relatedPrescriptionOrders.length > 1
												? "Batalkan obat ini saja"
												: getGroupPaymentStatus(relatedPrescriptionOrders) ===
													  "lunas"
													? "Batalkan & kembalikan dana"
													: "Batalkan peracikan"}
										</Button>
									</div>
								</div>
							) : null}

							<div
								className={`${softPanelClass} space-y-3 p-4`}
							>
								<p className="font-semibold text-emerald-900 text-sm dark:text-emerald-100">
									Proses peracikan & label
								</p>
								<div className="flex flex-wrap gap-2">
									{selectedHistoryNextAction ? (
										<Button
											type="button"
											size="sm"
											className={primaryActionClass}
											disabled={
												isSelectedHistoryUpdating ||
												isSelectedHistoryGeneratingLabel ||
												(!isSelectedHistoryPaymentLunas &&
													selectedHistoryNextAction.target ===
														"sedang_diracik")
											}
											onClick={() =>
												void handleManageWorkflowFromHistory(
													selectedHistoryNextAction.target,
												)
											}
										>
											{isSelectedHistoryUpdating ? (
												<Loader2 className="h-4 w-4 animate-spin" />
											) : (
												<Check className="h-4 w-4" />
											)}
											{!isSelectedHistoryPaymentLunas &&
											selectedHistoryNextAction.target === "sedang_diracik"
												? "Tunggu pembayaran"
												: selectedHistoryNextAction.label}
										</Button>
									) : (
										<span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2.5 py-1.5 text-emerald-800 text-xs font-medium dark:bg-emerald-950/50 dark:text-emerald-100">
											<CheckCircle2 className="h-3.5 w-3.5" />
											Proses selesai
										</span>
									)}
									<Button
										type="button"
										size="sm"
										variant="outline"
										className={secondaryActionClass}
										disabled={
											isSelectedHistoryUpdating ||
											isSelectedHistoryGeneratingLabel
										}
										onClick={() =>
											void handleGenerateLabelForOrder(selectedHistoryOrder)
										}
									>
										{isSelectedHistoryGeneratingLabel ? (
											<Loader2 className="h-4 w-4 animate-spin" />
										) : (
											<Printer className="h-4 w-4" />
										)}
										Buat label
									</Button>
									{labelPreview &&
									labelOrderId === selectedHistoryOrder.id ? (
										<Button
											type="button"
											size="sm"
											variant="outline"
											className={secondaryActionClass}
											onClick={handlePrintLabelPreview}
										>
											<Printer className="h-4 w-4" />
											Cetak label
										</Button>
									) : null}
								</div>
							</div>

							{labelPreview && labelOrderId === selectedHistoryOrder.id ? (
								<div className="rounded-lg border border-dashed border-emerald-200 bg-white p-4 dark:border-emerald-900/60 dark:bg-emerald-950/10">
									<p className="mb-2 font-semibold text-emerald-900 text-sm dark:text-emerald-100">
										Preview label
									</p>
									<div className="space-y-1 text-xs">
										<p>
											<span className="text-muted-foreground">Pasien:</span>{" "}
											{labelPreview.patientName}
										</p>
										<p>
											<span className="text-muted-foreground">Obat:</span>{" "}
											{labelPreview.medicineName}
										</p>
										<p>
											<span className="text-muted-foreground">Aturan:</span>{" "}
											{labelPreview.dosage}
										</p>
										<p>
											<span className="text-muted-foreground">Durasi:</span>{" "}
											{labelPreview.duration}
										</p>
									</div>
								</div>
							) : null}
						</DialogScrollBody>
					) : null}
					<div className="flex shrink-0 justify-end gap-2 border-emerald-100 border-t bg-emerald-50/95 px-5 py-4 dark:border-emerald-900/60 dark:bg-emerald-950/90">
						<Button
							type="button"
							variant="outline"
							className={secondaryActionClass}
							onClick={() => {
								setIsHistoryDetailOpen(false);
								setLabelPreview(null);
								setLabelOrderId(null);
							}}
						>
							Tutup
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			<Dialog
				open={isEditResepOpen}
				onOpenChange={(open) => {
					setIsEditResepOpen(open);
					if (!open) {
						clearMedicineSuggestions(EDIT_MEDICINE_SUGGESTION_ID);
						if (activeMedicineObatId === EDIT_MEDICINE_SUGGESTION_ID) {
							setActiveMedicineObatId(null);
						}
						if (selectedHistoryOrder) {
							resetManageOrderForm(selectedHistoryOrder);
						}
					}
				}}
			>
				<DialogContent
					scrollResetKey={
						isEditResepOpen && selectedHistoryOrder
							? `edit-resep-${selectedHistoryOrder.id}`
							: "edit-resep-closed"
					}
					className="flex max-h-[min(85dvh,calc(100dvh-2rem))] w-full max-w-lg flex-col gap-0 overflow-hidden border-emerald-200 bg-white p-0 shadow-xl dark:border-emerald-900/70 dark:bg-slate-950"
				>
					<DialogHeader className="shrink-0 border-b border-emerald-200 bg-emerald-50 px-5 py-4 dark:border-emerald-900/70 dark:bg-emerald-950/25">
						<DialogTitle className="flex items-center gap-2 text-emerald-950 dark:text-emerald-50">
							<Pencil className="h-5 w-5" />
							Edit resep / data obat
						</DialogTitle>
						<DialogDescription className="text-emerald-900/70 dark:text-emerald-100/70">
							{selectedHistoryOrder
								? `${selectedHistoryOrder.patientName} · ${selectedHistoryOrder.nomorPeresepan ?? "-"}`
								: "Perbarui nomor obat, nama, dosis, dan jumlah."}
						</DialogDescription>
					</DialogHeader>
					{selectedHistoryOrder ? (
						<DialogScrollBody className="space-y-4 p-5 text-sm">
							<p className="text-emerald-900/80 text-xs dark:text-emerald-100/80">
								Pastikan nomor obat dan nama obat sesuai agar stok dan konfirmasi
								diserahkan tidak salah.
							</p>
							<div className="grid grid-cols-1 gap-3">
								<div className="relative space-y-1.5">
									<label
										className="text-xs font-medium text-slate-600 dark:text-slate-300"
										htmlFor="editMedicineNameDialog"
									>
										Nama obat
									</label>
									<Input
										id="editMedicineNameDialog"
										value={editMedicineName}
										onChange={(event) =>
											handleEditMedicineNameChange(event.target.value)
										}
										onFocus={() => {
											setActiveMedicineObatId(EDIT_MEDICINE_SUGGESTION_ID);
											if (editMedicineName.trim().length >= 2) {
												scheduleMedicineSearch(
													EDIT_MEDICINE_SUGGESTION_ID,
													editMedicineName,
												);
											}
										}}
										onBlur={() => {
											tryAutoMatchEditMedicineOnBlur();
											window.setTimeout(() => {
												if (
													activeMedicineObatId === EDIT_MEDICINE_SUGGESTION_ID
												) {
													setActiveMedicineObatId(null);
												}
											}, 150);
										}}
										onKeyDown={handleEditMedicineNameKeyDown}
										placeholder="Ketik minimal 2 huruf untuk rekomendasi obat"
										maxLength={120}
										autoComplete="off"
										className={quietInputClass}
									/>
									{activeMedicineObatId === EDIT_MEDICINE_SUGGESTION_ID ? (
										<div className="mt-1.5">
											<SuggestionPanel
												options={dedupeMedicineSuggestions(
													medicineSuggestionsByObatId[
														EDIT_MEDICINE_SUGGESTION_ID
													] ?? [],
												).map((medicine) => ({
													id: medicine.id,
													primary: medicine.nama,
													secondary: medicine.nomorObat,
													meta: `${medicine.stok} ${medicine.satuan} · ${stockStatusLabel(medicine.status)}`,
												}))}
												isLoading={
													medicineSuggestionLoadingId ===
													EDIT_MEDICINE_SUGGESTION_ID
												}
												highlightedIndex={highlightedEditMedicineIdx}
												onHighlight={setHighlightedEditMedicineIdx}
												onSelect={(option) => {
													const medicine = (
														medicineSuggestionsByObatId[
															EDIT_MEDICINE_SUGGESTION_ID
														] ?? []
													).find((item) => item.id === option.id);
													if (medicine) {
														handleSelectEditMedicineFromSuggestion(medicine);
													}
												}}
												emptyMessage={
													editMedicineName.trim().length < 2
														? "Ketik minimal 2 huruf untuk rekomendasi obat."
														: "Obat tidak ditemukan di stok/katalog."
												}
											/>
										</div>
									) : null}
								</div>
								<div className="space-y-1.5">
									<label
										className="text-xs font-medium text-slate-600 dark:text-slate-300"
										htmlFor="editNomorObatDialog"
									>
										Nomor obat
									</label>
									<Input
										id="editNomorObatDialog"
										value={editNomorObat}
										readOnly
										tabIndex={-1}
										placeholder={
											editMedicineName.trim()
												? "Terisi otomatis dari nama obat"
												: "Pilih atau ketik nama obat dulu"
										}
										className={`${quietInputClass} bg-slate-100 font-mono text-slate-800 dark:bg-slate-900/60`}
									/>
								</div>
								<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
									<div className="space-y-1.5">
										<label
											className="text-xs font-medium text-slate-600 dark:text-slate-300"
											htmlFor="editDosageDialog"
										>
											Dosis
										</label>
										<Input
											id="editDosageDialog"
											value={editDosage}
											onChange={(event) => setEditDosage(event.target.value)}
											placeholder="Contoh: 1 x 1"
											className={quietInputClass}
										/>
									</div>
									<div className="space-y-1.5">
										<label
											className="text-xs font-medium text-slate-600 dark:text-slate-300"
											htmlFor="editQuantityDialog"
										>
											Jumlah
										</label>
										<Input
											id="editQuantityDialog"
											type="number"
											min={1}
											max={500}
											value={editQuantity}
											onChange={(event) => setEditQuantity(event.target.value)}
											className={quietInputClass}
										/>
									</div>
								</div>
							</div>
						</DialogScrollBody>
					) : null}
					<div className="flex shrink-0 flex-wrap justify-end gap-2 border-emerald-100 border-t bg-emerald-50/95 px-5 py-4 dark:border-emerald-900/60 dark:bg-emerald-950/90">
						<Button
							type="button"
							variant="outline"
							className={secondaryActionClass}
							disabled={isSavingOrderDetails}
							onClick={() => setIsEditResepOpen(false)}
						>
							Batal
						</Button>
						<Button
							type="button"
							size="sm"
							className={primaryActionClass}
							disabled={isSavingOrderDetails || isSelectedHistoryUpdating}
							onClick={() => void handleSaveOrderDetails()}
						>
							{isSavingOrderDetails ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Check className="h-4 w-4" />
							)}
							Simpan perubahan
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
