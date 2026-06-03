import type {
	DemoDispensingOrder,
	DemoDispensingWorkflowStatus,
} from "@/lib/demo/types";

export type DispensingPeriodFilter =
	| "Hari ini"
	| "Kemarin"
	| "7 Hari Terakhir"
	| "30 Hari Terakhir";

export type DispensingStatusFilter =
	| "Semua"
	| "Menunggu"
	| "Proses"
	| "Selesai";

export type DispensingServiceFilter =
	| "Semua"
	| "Rawat Jalan"
	| "Rawat Inap"
	| "UGD"
	| "CITO";

export type DispensingQueueView = "antrean" | "riwayat" | "semua";

export interface DispensingDashboardFilterState {
	searchQuery: string;
	period: DispensingPeriodFilter;
	statusPeracikan: DispensingStatusFilter;
	tipeLayanan: DispensingServiceFilter;
	queueView: DispensingQueueView;
}

export function matchesQueueView(
	workflowStatus: DemoDispensingWorkflowStatus,
	view: DispensingQueueView,
): boolean {
	if (view === "semua") {
		return true;
	}

	if (view === "riwayat") {
		return workflowStatus === "diserahkan" || workflowStatus === "cancel";
	}

	return workflowStatus !== "diserahkan" && workflowStatus !== "cancel";
}

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function isOrderInPeriod(
	order: DemoDispensingOrder,
	period: DispensingPeriodFilter,
	referenceDate = new Date(),
): boolean {
	const created = new Date(order.createdAt);
	if (Number.isNaN(created.getTime())) {
		return false;
	}

	const today = startOfDay(referenceDate);
	const orderDay = startOfDay(created);

	switch (period) {
		case "Hari ini":
			return orderDay.getTime() === today.getTime();
		case "Kemarin": {
			const yesterday = new Date(today);
			yesterday.setDate(yesterday.getDate() - 1);
			return orderDay.getTime() === yesterday.getTime();
		}
		case "7 Hari Terakhir": {
			const from = new Date(today);
			from.setDate(from.getDate() - 6);
			return orderDay >= from && orderDay <= today;
		}
		case "30 Hari Terakhir": {
			const from = new Date(today);
			from.setDate(from.getDate() - 29);
			return orderDay >= from && orderDay <= today;
		}
		default:
			return true;
	}
}

/** Inferensi tipe layanan dari pola nomor resep (sampai field khusus tersedia di order). */
export function inferOrderServiceType(
	order: DemoDispensingOrder,
): Exclude<DispensingServiceFilter, "Semua"> {
	const nomor = (order.nomorPeresepan ?? "").toUpperCase();

	if (nomor.includes("CITO")) {
		return "CITO";
	}

	if (nomor.includes("UGD") || nomor.includes("IGD")) {
		return "UGD";
	}

	if (nomor.includes("INAP") || nomor.includes("RI-")) {
		return "Rawat Inap";
	}

	return "Rawat Jalan";
}

export function matchesWorkflowStatusFilter(
	workflowStatus: DemoDispensingWorkflowStatus,
	filter: DispensingStatusFilter,
): boolean {
	if (filter === "Semua") {
		return true;
	}

	if (filter === "Menunggu") {
		return (
			workflowStatus === "menunggu_validasi_resep" ||
			workflowStatus === "menunggu_pembayaran"
		);
	}

	if (filter === "Proses") {
		return (
			workflowStatus === "sedang_diracik" || workflowStatus === "siap_diracik"
		);
	}

	if (filter === "Selesai") {
		return (
			workflowStatus === "siap_diserahkan" || workflowStatus === "diserahkan"
		);
	}

	return true;
}

export function computeDispensingStatistics(
	orders: DemoDispensingOrder[],
	resolveWorkflowStatus: (
		order: DemoDispensingOrder,
	) => DemoDispensingWorkflowStatus,
) {
	let waiting = 0;
	let completed = 0;

	for (const order of orders) {
		const workflowStatus = resolveWorkflowStatus(order);

		if (workflowStatus === "diserahkan") {
			completed += 1;
			continue;
		}

		if (workflowStatus !== "cancel") {
			waiting += 1;
		}
	}

	return {
		total: orders.length,
		waiting,
		completed,
	};
}

export function filterDispensingOrders(
	orders: DemoDispensingOrder[],
	filters: DispensingDashboardFilterState,
	resolveWorkflowStatus: (
		order: DemoDispensingOrder,
	) => DemoDispensingWorkflowStatus,
	normalizeSearchText: (value: string) => string,
): DemoDispensingOrder[] {
	const normalizedQuery = normalizeSearchText(filters.searchQuery);

	return orders.filter((order) => {
		if (!isOrderInPeriod(order, filters.period)) {
			return false;
		}

		const workflowStatus = resolveWorkflowStatus(order);
		if (!matchesWorkflowStatusFilter(workflowStatus, filters.statusPeracikan)) {
			return false;
		}

		if (
			filters.tipeLayanan !== "Semua" &&
			inferOrderServiceType(order) !== filters.tipeLayanan
		) {
			return false;
		}

		if (!matchesQueueView(workflowStatus, filters.queueView)) {
			return false;
		}

		if (!normalizedQuery) {
			return true;
		}

		const haystack = [
			order.nomorRM ?? "",
			order.nomorPeresepan ?? "",
			order.patientName,
			order.nomorObat ?? "",
			order.medicineName,
		]
			.map((value) => normalizeSearchText(value))
			.join(" ");

		return haystack.includes(normalizedQuery);
	});
}

export function getPeriodSummaryLabel(period: DispensingPeriodFilter): string {
	switch (period) {
		case "Hari ini":
			return "Hari ini";
		case "Kemarin":
			return "Kemarin";
		case "7 Hari Terakhir":
			return "7 hari terakhir";
		case "30 Hari Terakhir":
			return "30 hari terakhir";
		default:
			return "Periode terpilih";
	}
}

export function hasActiveDashboardFilters(
	filters: DispensingDashboardFilterState,
): boolean {
	return (
		filters.searchQuery.trim().length > 0 ||
		filters.statusPeracikan !== "Semua" ||
		filters.tipeLayanan !== "Semua" ||
		filters.period !== "Hari ini" ||
		filters.queueView !== "antrean"
	);
}

export function getQueueViewLabel(view: DispensingQueueView): string {
	switch (view) {
		case "antrean":
			return "Antrean aktif";
		case "riwayat":
			return "Riwayat selesai";
		default:
			return "Semua data";
	}
}

export interface DispensingPrescriptionQueueGroup {
	key: string;
	nomorPeresepan: string;
	nomorRM?: string;
	patientName: string;
	createdAt: string;
	orders: DemoDispensingOrder[];
}

/** Satu baris antrean per nomor resep (beberapa obat digabung). */
export function groupDispensingOrdersByPrescription(
	orders: DemoDispensingOrder[],
): DispensingPrescriptionQueueGroup[] {
	const groups = new Map<string, DemoDispensingOrder[]>();

	for (const order of orders) {
		const resepKey = (order.nomorPeresepan?.trim().toUpperCase() || order.id).toUpperCase();
		const rmKey = (order.nomorRM?.trim().toUpperCase() || "").toUpperCase();
		const patientKey = order.patientName.trim().toLowerCase();
		const key = `${resepKey}::${rmKey}::${patientKey}`;

		const bucket = groups.get(key) ?? [];
		bucket.push(order);
		groups.set(key, bucket);
	}

	return [...groups.entries()]
		.map(([key, groupOrders]) => {
			const sorted = [...groupOrders].sort(
				(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
			);
			const primary = sorted[0]!;

			return {
				key,
				nomorPeresepan: primary.nomorPeresepan ?? primary.id,
				nomorRM: primary.nomorRM,
				patientName: primary.patientName,
				createdAt: sorted[0]!.createdAt,
				orders: sorted,
			};
		})
		.sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);
}
