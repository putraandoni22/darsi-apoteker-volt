import { type NextRequest, NextResponse } from "next/server";
import { logActivitySafe } from "@/lib/activity/store";
import { getApiAuthenticatedUser } from "@/lib/auth/guards";
import { findUserById } from "@/lib/auth/store";
import {
	isDispensingWorkflowStatus,
	isDispensingWorkflowTransitionStatus,
} from "@/lib/demo/dispensing-workflow";
import {
	cancelDispensingOrderWithRefund,
	createDispensingOrder,
	DispensingOrderManageError,
	DispensingPrescriptionError,
	DispensingWorkflowUpdateError,
	InsufficientStockError,
	listDispensingOrders,
	resetDispensingData,
	updateDispensingOrderDetails,
	updateDispensingOrderWorkflow,
} from "@/lib/demo/store";
import { isApotekerDispensingDataResetEnabled } from "@/lib/apoteker/apoteker-runtime-config";
import type { DemoPaymentStatus } from "@/lib/demo/types";

export const dynamic = "force-dynamic";

function isPaymentStatus(value: unknown): value is DemoPaymentStatus {
	return (
		value === "menunggu_bayar" ||
		value === "lunas" ||
		value === "gagal" ||
		value === "dibatalkan" ||
		value === "refund"
	);
}

function normalizeSearchText(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function GET(request: NextRequest) {
	const user = await getApiAuthenticatedUser(request);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	if (user.role !== "admin" && user.role !== "apoteker") {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const paymentStatusQuery =
		request.nextUrl.searchParams.get("paymentStatus")?.trim() ?? "";
	const workflowStatusQuery =
		request.nextUrl.searchParams.get("workflowStatus")?.trim() ?? "";
	const nomorPeresepanQuery =
		request.nextUrl.searchParams.get("nomorPeresepan")?.trim().toUpperCase() ??
		"";
	const nomorRMQuery =
		request.nextUrl.searchParams.get("nomorRM")?.trim().toUpperCase() ?? "";
	const nomorObatQuery =
		request.nextUrl.searchParams.get("nomorObat")?.trim().toUpperCase() ?? "";

	if (paymentStatusQuery.length > 0 && !isPaymentStatus(paymentStatusQuery)) {
		return NextResponse.json(
			{ error: "Parameter paymentStatus tidak valid." },
			{ status: 400 },
		);
	}

	if (
		workflowStatusQuery.length > 0 &&
		!isDispensingWorkflowStatus(workflowStatusQuery)
	) {
		return NextResponse.json(
			{ error: "Parameter workflowStatus tidak valid." },
			{ status: 400 },
		);
	}

	if (nomorObatQuery.length > 0 && !/^[A-Z0-9-]{2,32}$/.test(nomorObatQuery)) {
		return NextResponse.json(
			{ error: "Parameter nomorObat tidak valid." },
			{ status: 400 },
		);
	}

	const paymentStatusFilter =
		paymentStatusQuery.length > 0 && isPaymentStatus(paymentStatusQuery)
			? paymentStatusQuery
			: undefined;
	const workflowStatusFilter =
		workflowStatusQuery.length > 0 &&
		isDispensingWorkflowStatus(workflowStatusQuery)
			? workflowStatusQuery
			: undefined;

	const orders = await listDispensingOrders({
		paymentStatus: paymentStatusFilter,
		workflowStatus: workflowStatusFilter,
		nomorPeresepan: nomorPeresepanQuery || undefined,
		nomorRM: nomorRMQuery || undefined,
		nomorObat: nomorObatQuery || undefined,
	});

	return NextResponse.json({
		orders,
		filters: {
			paymentStatus: paymentStatusQuery,
			workflowStatus: workflowStatusQuery,
			nomorPeresepan: nomorPeresepanQuery,
			nomorRM: nomorRMQuery,
			nomorObat: nomorObatQuery,
		},
	});
}

export async function POST(request: NextRequest) {
	const user = await getApiAuthenticatedUser(request);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	if (user.role !== "admin" && user.role !== "apoteker") {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json(
			{ error: "Request body tidak valid." },
			{ status: 400 },
		);
	}

	if (!body || typeof body !== "object") {
		return NextResponse.json(
			{ error: "Request body tidak valid." },
			{ status: 400 },
		);
	}

	const patientName = (body as { patientName?: unknown }).patientName;
	const medicineName = (body as { medicineName?: unknown }).medicineName;
	const dosage = (body as { dosage?: unknown }).dosage;
	const quantity = (body as { quantity?: unknown }).quantity;
	const nomorRM = (body as { nomorRM?: unknown }).nomorRM;
	const nomorPeresepan = (body as { nomorPeresepan?: unknown }).nomorPeresepan;
	const nomorObat = (body as { nomorObat?: unknown }).nomorObat;
	const paymentStatus = (body as { paymentStatus?: unknown }).paymentStatus;
	const doctorName = (body as { doctorName?: unknown }).doctorName;
	const patientUserId = (body as { patientUserId?: unknown }).patientUserId;
	const autoCreatePrescription = (body as { autoCreatePrescription?: unknown })
		.autoCreatePrescription;

	const normalizedPatientName =
		typeof patientName === "string" ? patientName.trim() : "";
	const normalizedMedicineName =
		typeof medicineName === "string" ? medicineName.trim() : "";
	const normalizedDosage = typeof dosage === "string" ? dosage.trim() : "";
	const normalizedNomorRM =
		typeof nomorRM === "string" ? nomorRM.trim().toUpperCase() : "";
	const normalizedNomorPeresepan =
		typeof nomorPeresepan === "string"
			? nomorPeresepan.trim().toUpperCase()
			: "";
	const normalizedNomorObat =
		typeof nomorObat === "string" ? nomorObat.trim().toUpperCase() : "";
	const normalizedDoctorName =
		typeof doctorName === "string" ? doctorName.trim() : "";
	const normalizedPatientUserId =
		typeof patientUserId === "string" ? patientUserId.trim() : "";
	const shouldAutoCreatePrescription = autoCreatePrescription === true;

	if (typeof patientName !== "undefined" && typeof patientName !== "string") {
		return NextResponse.json(
			{ error: "Nama pasien tidak valid." },
			{ status: 400 },
		);
	}

	if (
		normalizedPatientName.length > 0 &&
		(normalizedPatientName.length < 2 || normalizedPatientName.length > 80)
	) {
		return NextResponse.json(
			{ error: "Nama pasien tidak valid." },
			{ status: 400 },
		);
	}

	if (
		typeof patientUserId !== "undefined" &&
		typeof patientUserId !== "string"
	) {
		return NextResponse.json(
			{ error: "ID user pasien tidak valid." },
			{ status: 400 },
		);
	}

	if (normalizedPatientUserId.length > 120) {
		return NextResponse.json(
			{ error: "ID user pasien tidak valid." },
			{ status: 400 },
		);
	}

	if (typeof doctorName !== "undefined" && typeof doctorName !== "string") {
		return NextResponse.json(
			{ error: "Nama dokter tidak valid." },
			{ status: 400 },
		);
	}

	if (
		normalizedDoctorName.length > 0 &&
		(normalizedDoctorName.length < 2 || normalizedDoctorName.length > 80)
	) {
		return NextResponse.json(
			{ error: "Nama dokter tidak valid." },
			{ status: 400 },
		);
	}

	if (
		typeof autoCreatePrescription !== "undefined" &&
		typeof autoCreatePrescription !== "boolean"
	) {
		return NextResponse.json(
			{ error: "Parameter autoCreatePrescription harus boolean." },
			{ status: 400 },
		);
	}

	if (typeof medicineName !== "undefined" && typeof medicineName !== "string") {
		return NextResponse.json(
			{ error: "Nama obat tidak valid." },
			{ status: 400 },
		);
	}

	if (
		normalizedMedicineName.length > 0 &&
		(normalizedMedicineName.length < 2 || normalizedMedicineName.length > 120)
	) {
		return NextResponse.json(
			{ error: "Nama obat tidak valid." },
			{ status: 400 },
		);
	}

	if (typeof dosage !== "undefined" && typeof dosage !== "string") {
		return NextResponse.json({ error: "Dosis tidak valid." }, { status: 400 });
	}

	if (
		normalizedDosage.length > 0 &&
		(normalizedDosage.length < 2 || normalizedDosage.length > 120)
	) {
		return NextResponse.json({ error: "Dosis tidak valid." }, { status: 400 });
	}

	let normalizedQuantity: number | undefined;
	if (typeof quantity !== "undefined") {
		const parsedQuantity =
			typeof quantity === "number"
				? quantity
				: typeof quantity === "string"
					? Number.parseInt(quantity, 10)
					: Number.NaN;

		if (
			!Number.isFinite(parsedQuantity) ||
			parsedQuantity <= 0 ||
			!Number.isInteger(parsedQuantity)
		) {
			return NextResponse.json(
				{ error: "Jumlah obat tidak valid." },
				{ status: 400 },
			);
		}

		if (parsedQuantity > 500) {
			return NextResponse.json(
				{ error: "Jumlah obat terlalu besar untuk mode demo (maksimal 500)." },
				{ status: 400 },
			);
		}

		normalizedQuantity = parsedQuantity;
	}

	if (typeof nomorRM !== "undefined" && typeof nomorRM !== "string") {
		return NextResponse.json(
			{ error: "Nomor RM tidak valid." },
			{ status: 400 },
		);
	}

	if (
		normalizedNomorRM.length > 0 &&
		!/^[A-Z0-9-]{3,32}$/.test(normalizedNomorRM)
	) {
		return NextResponse.json(
			{ error: "Format nomor RM tidak valid." },
			{ status: 400 },
		);
	}

	if (
		typeof nomorPeresepan !== "undefined" &&
		typeof nomorPeresepan !== "string"
	) {
		return NextResponse.json(
			{ error: "Nomor peresepan tidak valid." },
			{ status: 400 },
		);
	}

	if (normalizedNomorPeresepan.length === 0) {
		return NextResponse.json(
			{ error: "Nomor peresepan wajib diisi untuk rekonsiliasi resep dokter." },
			{ status: 400 },
		);
	}

	if (
		normalizedNomorPeresepan.length > 0 &&
		!/^[A-Z0-9-]{5,40}$/.test(normalizedNomorPeresepan)
	) {
		return NextResponse.json(
			{ error: "Format nomor peresepan tidak valid." },
			{ status: 400 },
		);
	}

	if (typeof nomorObat !== "undefined" && typeof nomorObat !== "string") {
		return NextResponse.json(
			{ error: "Nomor obat tidak valid." },
			{ status: 400 },
		);
	}

	if (
		normalizedNomorObat.length > 0 &&
		!/^[A-Z0-9-]{3,32}$/.test(normalizedNomorObat)
	) {
		return NextResponse.json(
			{ error: "Format nomor obat tidak valid." },
			{ status: 400 },
		);
	}

	if (typeof paymentStatus !== "undefined" && !isPaymentStatus(paymentStatus)) {
		return NextResponse.json(
			{ error: "Status pembayaran tidak valid." },
			{ status: 400 },
		);
	}

	let linkedPatientUserId: string | undefined;
	let linkedPatientName: string | undefined;

	if (normalizedPatientUserId.length > 0) {
		const linkedUser = await findUserById(normalizedPatientUserId);
		if (!linkedUser || linkedUser.role !== "pasien") {
			return NextResponse.json(
				{ error: "Akun pasien tidak ditemukan atau bukan role pasien." },
				{ status: 400 },
			);
		}

		linkedPatientUserId = linkedUser.id;
		linkedPatientName = linkedUser.name.trim();
	}

	const effectivePatientName = normalizedPatientName || linkedPatientName || "";

	if (
		effectivePatientName.length > 0 &&
		(effectivePatientName.length < 2 || effectivePatientName.length > 80)
	) {
		return NextResponse.json(
			{ error: "Nama pasien tidak valid." },
			{ status: 400 },
		);
	}

	if (
		normalizedPatientName.length > 0 &&
		linkedPatientName &&
		normalizeSearchText(normalizedPatientName) !==
			normalizeSearchText(linkedPatientName)
	) {
		return NextResponse.json(
			{
				error:
					"Nama pasien tidak sesuai dengan akun pasien yang dipilih. Samakan nama atau kosongkan field nama pasien.",
			},
			{ status: 400 },
		);
	}

	if (shouldAutoCreatePrescription && effectivePatientName.length === 0) {
		return NextResponse.json(
			{
				error:
					"Nama pasien wajib diisi untuk membuat resep baru dari menu dispensing.",
			},
			{ status: 400 },
		);
	}

	if (shouldAutoCreatePrescription && normalizedMedicineName.length === 0) {
		return NextResponse.json(
			{
				error:
					"Nama obat wajib diisi untuk membuat resep baru dari menu dispensing.",
			},
			{ status: 400 },
		);
	}

	if (shouldAutoCreatePrescription && normalizedNomorObat.length === 0) {
		return NextResponse.json(
			{
				error:
					"Nomor obat wajib diisi untuk membuat resep baru dari menu dispensing.",
			},
			{ status: 400 },
		);
	}

	if (shouldAutoCreatePrescription && normalizedDosage.length === 0) {
		return NextResponse.json(
			{
				error:
					"Dosis wajib diisi untuk membuat resep baru dari menu dispensing.",
			},
			{ status: 400 },
		);
	}

	if (shouldAutoCreatePrescription && typeof normalizedQuantity !== "number") {
		return NextResponse.json(
			{
				error:
					"Jumlah obat wajib diisi untuk membuat resep baru dari menu dispensing.",
			},
			{ status: 400 },
		);
	}

	const normalizedPaymentStatus = isPaymentStatus(paymentStatus)
		? paymentStatus
		: undefined;

	let order: Awaited<ReturnType<typeof createDispensingOrder>>;
	try {
		const allowCustomPrescriptionItem =
			(body as { allowCustomPrescriptionItem?: unknown })
				.allowCustomPrescriptionItem === true ||
			(normalizedMedicineName.length > 0 && !shouldAutoCreatePrescription);

		order = await createDispensingOrder({
			patientName: effectivePatientName || undefined,
			patientUserId: linkedPatientUserId,
			nomorRM: normalizedNomorRM || undefined,
			nomorPeresepan: normalizedNomorPeresepan || undefined,
			nomorObat: normalizedNomorObat || undefined,
			medicineName: normalizedMedicineName || undefined,
			dosage: normalizedDosage || undefined,
			quantity: normalizedQuantity,
			doctorName: normalizedDoctorName || undefined,
			autoCreatePrescription: shouldAutoCreatePrescription,
			allowCustomPrescriptionItem,
			paymentStatus: normalizedPaymentStatus,
			actorUserId: user.id,
		});
	} catch (error) {
		if (error instanceof DispensingPrescriptionError) {
			return NextResponse.json(
				{
					error: error.message,
					details: error.details,
				},
				{ status: 400 },
			);
		}

		if (error instanceof InsufficientStockError) {
			return NextResponse.json(
				{
					error: error.message,
					details: {
						medicineName: error.medicineName,
						available: error.available,
						requested: error.requested,
					},
				},
				{ status: 400 },
			);
		}

		throw error;
	}

	await logActivitySafe({
		module: "APOTEKER",
		action: "DISPENSING_CREATED",
		detail: `Order dispensing ${order.nomorPeresepan ?? "-"} untuk pasien ${order.patientName} (${order.medicineName}) berhasil dibuat dengan status bayar ${order.paymentStatus ?? "menunggu_bayar"}.`,
		user: { id: user.id, name: user.name, role: user.role },
		request,
	});

	return NextResponse.json({ order }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
	const user = await getApiAuthenticatedUser(request);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	if (user.role !== "admin" && user.role !== "apoteker") {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json(
			{ error: "Request body tidak valid." },
			{ status: 400 },
		);
	}

	if (!body || typeof body !== "object") {
		return NextResponse.json(
			{ error: "Request body tidak valid." },
			{ status: 400 },
		);
	}

	const orderId = (body as { orderId?: unknown }).orderId;
	const workflowStatus = (body as { workflowStatus?: unknown }).workflowStatus;
	const cancel = (body as { cancel?: unknown }).cancel === true;
	const cancelReason = (body as { cancelReason?: unknown }).cancelReason;
	const medicineName = (body as { medicineName?: unknown }).medicineName;
	const nomorObat = (body as { nomorObat?: unknown }).nomorObat;
	const dosage = (body as { dosage?: unknown }).dosage;
	const quantity = (body as { quantity?: unknown }).quantity;

	if (typeof orderId !== "string") {
		return NextResponse.json(
			{ error: "Order ID tidak valid." },
			{ status: 400 },
		);
	}

	const normalizedOrderId = orderId.trim();
	if (normalizedOrderId.length < 3 || normalizedOrderId.length > 64) {
		return NextResponse.json(
			{ error: "Order ID tidak valid." },
			{ status: 400 },
		);
	}

	if (cancel) {
		const normalizedReason =
			typeof cancelReason === "string" ? cancelReason.trim() : "";

		try {
			const result = await cancelDispensingOrderWithRefund({
				orderId: normalizedOrderId,
				reason: normalizedReason || undefined,
				actorUserId: user.id,
			});

			await logActivitySafe({
				module: "APOTEKER",
				action: "DISPENSING_CANCELLED",
				detail: result.refunded
					? `Order ${result.order.id} dibatalkan. Refund Rp ${result.refundAmount.toLocaleString("id-ID")} untuk ${result.order.patientName}.`
					: `Order ${result.order.id} dibatalkan untuk ${result.order.patientName}.`,
				user: { id: user.id, name: user.name, role: user.role },
				request,
			});

			return NextResponse.json({
				order: result.order,
				refunded: result.refunded,
				refundAmount: result.refundAmount,
			});
		} catch (error) {
			if (error instanceof DispensingOrderManageError) {
				return NextResponse.json(
					{ error: error.message, details: error.details },
					{ status: 400 },
				);
			}

			console.error("[dispensing PATCH cancel]", error);
			return NextResponse.json(
				{ error: "Gagal membatalkan order dispensing." },
				{ status: 500 },
			);
		}
	}

	const hasDetailUpdate =
		typeof medicineName === "string" ||
		typeof nomorObat === "string" ||
		typeof dosage === "string" ||
		typeof quantity !== "undefined";

	if (hasDetailUpdate && !isDispensingWorkflowTransitionStatus(workflowStatus)) {
		let normalizedQuantity: number | undefined;
		if (typeof quantity !== "undefined") {
			const parsedQuantity =
				typeof quantity === "number"
					? quantity
					: typeof quantity === "string"
						? Number.parseInt(quantity, 10)
						: Number.NaN;

			if (
				!Number.isFinite(parsedQuantity) ||
				parsedQuantity <= 0 ||
				!Number.isInteger(parsedQuantity)
			) {
				return NextResponse.json(
					{ error: "Jumlah obat tidak valid." },
					{ status: 400 },
				);
			}

			normalizedQuantity = parsedQuantity;
		}

		try {
			const order = await updateDispensingOrderDetails({
				orderId: normalizedOrderId,
				nomorObat:
					typeof nomorObat === "string" ? nomorObat.trim().toUpperCase() : undefined,
				medicineName:
					typeof medicineName === "string" ? medicineName.trim() : undefined,
				dosage: typeof dosage === "string" ? dosage.trim() : undefined,
				quantity: normalizedQuantity,
				actorUserId: user.id,
			});

			await logActivitySafe({
				module: "APOTEKER",
				action: "DISPENSING_ORDER_UPDATED",
				detail: `Data obat order ${order.id} (${order.medicineName}) diperbarui oleh apoteker.`,
				user: { id: user.id, name: user.name, role: user.role },
				request,
			});

			return NextResponse.json({ order });
		} catch (error) {
			if (error instanceof DispensingOrderManageError) {
				return NextResponse.json(
					{ error: error.message, details: error.details },
					{ status: 400 },
				);
			}

			console.error("[dispensing PATCH update]", error);
			return NextResponse.json(
				{ error: "Gagal memperbarui data obat dispensing." },
				{ status: 500 },
			);
		}
	}

	if (!isDispensingWorkflowTransitionStatus(workflowStatus)) {
		return NextResponse.json(
			{
				error:
					"Permintaan tidak valid. Kirim workflowStatus, data obat, atau cancel=true.",
			},
			{ status: 400 },
		);
	}

	let order: Awaited<ReturnType<typeof updateDispensingOrderWorkflow>>;
	try {
		order = await updateDispensingOrderWorkflow({
			orderId: normalizedOrderId,
			targetWorkflowStatus: workflowStatus,
			actorUserId: user.id,
		});
	} catch (error) {
		if (error instanceof DispensingWorkflowUpdateError) {
			return NextResponse.json(
				{
					error: error.message,
					details: error.details,
				},
				{ status: 400 },
			);
		}

		if (error instanceof InsufficientStockError) {
			return NextResponse.json(
				{
					error: error.message,
					details: {
						medicineName: error.medicineName,
						available: error.available,
						requested: error.requested,
					},
				},
				{ status: 400 },
			);
		}

		console.error("[dispensing PATCH]", error);
		return NextResponse.json(
			{ error: "Gagal memperbarui status peracikan." },
			{ status: 500 },
		);
	}

	const workflowLabel =
		workflowStatus === "sedang_diracik"
			? "Diracik"
			: workflowStatus === "siap_diserahkan"
				? "Siap Diserahkan"
				: "Diserahkan";

	await logActivitySafe({
		module: "APOTEKER",
		action: "DISPENSING_WORKFLOW_UPDATED",
		detail: `Order ${order.id} untuk pasien ${order.patientName} diperbarui ke status ${workflowLabel}.`,
		user: { id: user.id, name: user.name, role: user.role },
		request,
	});

	return NextResponse.json({ order });
}

export async function DELETE(request: NextRequest) {
	const user = await getApiAuthenticatedUser(request);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	if (user.role !== "admin" && user.role !== "apoteker") {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	if (!isApotekerDispensingDataResetEnabled()) {
		return NextResponse.json(
			{
				error:
					"Fitur reset data dispensing dinonaktifkan pada server. Set DARSI_APOTEKER_ALLOW_DATA_RESET=true jika diperlukan.",
			},
			{ status: 403 },
		);
	}

	const confirmToken =
		request.nextUrl.searchParams.get("confirm")?.trim().toUpperCase() ?? "";
	if (confirmToken !== "RESET_DISPENSING_DATA") {
		return NextResponse.json(
			{
				error:
					"Permintaan reset ditolak. Tambahkan query confirm=RESET_DISPENSING_DATA untuk melanjutkan.",
			},
			{ status: 400 },
		);
	}

	const reset = await resetDispensingData();

	await logActivitySafe({
		module: "APOTEKER",
		action: "DISPENSING_RESET",
		detail: `Reset data dispensing dijalankan. Order: ${reset.deletedOrders}, resep: ${reset.deletedPrescriptions}, pembayaran: ${reset.deletedPayments}, pasien: ${reset.deletedPatients}, transaksi stok dispensing: ${reset.deletedTransactions}.`,
		user: { id: user.id, name: user.name, role: user.role },
		request,
	});

	return NextResponse.json({ reset });
}
