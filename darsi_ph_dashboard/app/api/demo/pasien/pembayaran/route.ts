import { NextResponse, type NextRequest } from "next/server";
import { getApiAuthenticatedUser } from "@/lib/auth/guards";
import { logActivitySafe } from "@/lib/activity/store";
import {
  confirmPatientPrescriptionPayment,
  InsufficientStockError,
  listPatientRecords,
  listPatientPrescriptionPayments,
} from "@/lib/demo/store";
import type { DemoPaymentMethod } from "@/lib/demo/types";

export const dynamic = "force-dynamic";

function isPaymentMethod(value: unknown): value is DemoPaymentMethod {
  return (
    value === "cash" ||
    value === "debit" ||
    value === "credit" ||
    value === "bpjs" ||
    value === "lainnya"
  );
}

function isValidNomorPeresepan(value: string): boolean {
  return /^[A-Z0-9-]{5,40}$/.test(value);
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function filterPaymentsForPatient(
  payments: Awaited<ReturnType<typeof listPatientPrescriptionPayments>>,
  patientName: string,
  patientUserId: string,
  patientRecords: Awaited<ReturnType<typeof listPatientRecords>>,
  nomorPeresepanQuery: string,
) {
  const linkedNomorRM = new Set(
    patientRecords
      .filter((item) => (item.userId ?? "").trim() === patientUserId)
      .map((item) => item.nomorRM.trim().toUpperCase())
      .filter((item) => item.length > 0),
  );

  if (linkedNomorRM.size > 0) {
    const linkedPayments = payments.filter((item) =>
      linkedNomorRM.has(item.nomorRM.trim().toUpperCase()),
    );

    if (linkedPayments.length > 0) {
      return linkedPayments;
    }
  }

  const normalizedPatientName = normalizeSearchText(patientName);
  const ownPayments = payments.filter(
    (item) => normalizeSearchText(item.patientName) === normalizedPatientName,
  );

  if (ownPayments.length > 0) {
    return ownPayments;
  }

  if (!nomorPeresepanQuery) {
    return [];
  }

  return payments.filter(
    (item) => item.nomorPeresepan.toUpperCase() === nomorPeresepanQuery,
  );
}

export async function GET(request: NextRequest) {
  const user = await getApiAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "pasien") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const nomorPeresepan =
    request.nextUrl.searchParams.get("nomorPeresepan")?.trim().toUpperCase() ?? "";

  if (nomorPeresepan.length > 0 && !isValidNomorPeresepan(nomorPeresepan)) {
    return NextResponse.json(
      { error: "Format nomor peresepan tidak valid." },
      { status: 400 },
    );
  }

  const [payments, patientRecords] = await Promise.all([
    listPatientPrescriptionPayments({
      nomorPeresepan: nomorPeresepan || undefined,
    }),
    listPatientRecords(),
  ]);

  return NextResponse.json({
    payments: filterPaymentsForPatient(
      payments,
      user.name,
      user.id,
      patientRecords,
      nomorPeresepan,
    ),
    filters: {
      nomorPeresepan,
    },
    methods: [
      { value: "cash", label: "Tunai" },
      { value: "debit", label: "Debit" },
      { value: "credit", label: "Kartu Kredit" },
      { value: "bpjs", label: "BPJS" },
      { value: "lainnya", label: "Lainnya" },
    ],
  });
}

export async function POST(request: NextRequest) {
  const user = await getApiAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "pasien") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body tidak valid." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body tidak valid." }, { status: 400 });
  }

  const nomorPeresepan =
    (body as { nomorPeresepan?: unknown }).nomorPeresepan;
  const metodeBayar =
    (body as { metodeBayar?: unknown }).metodeBayar;

  const normalizedNomorPeresepan =
    typeof nomorPeresepan === "string" ? nomorPeresepan.trim().toUpperCase() : "";

  if (!normalizedNomorPeresepan || !isValidNomorPeresepan(normalizedNomorPeresepan)) {
    return NextResponse.json(
      { error: "Nomor peresepan tidak valid." },
      { status: 400 },
    );
  }

  if (typeof metodeBayar !== "undefined" && !isPaymentMethod(metodeBayar)) {
    return NextResponse.json(
      { error: "Metode bayar tidak valid." },
      { status: 400 },
    );
  }

  try {
    const result = await confirmPatientPrescriptionPayment({
      nomorPeresepan: normalizedNomorPeresepan,
      metodeBayar: isPaymentMethod(metodeBayar) ? metodeBayar : "debit",
      actorUserId: user.id,
    });

    await logActivitySafe({
      module: "PASIEN",
      action: "PRESCRIPTION_PAYMENT_CONFIRMED",
      detail: `Konfirmasi pembayaran resep ${normalizedNomorPeresepan} diproses dengan metode ${result.payment.metodeBayar ?? "debit"}.`,
      user: { id: user.id, name: user.name, role: user.role },
      request,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Konfirmasi pembayaran gagal.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
