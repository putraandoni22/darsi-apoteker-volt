import { NextResponse, type NextRequest } from "next/server";
import { getApiAuthenticatedUser } from "@/lib/auth/guards";
import { logActivitySafe } from "@/lib/activity/store";
import { validatePrescription } from "@/lib/demo/store";

export const dynamic = "force-dynamic";

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
    return NextResponse.json({ error: "Request body tidak valid." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body tidak valid." }, { status: 400 });
  }

  const medicineName = (body as { medicineName?: unknown }).medicineName;
  const dosage = (body as { dosage?: unknown }).dosage;
  const frequency = (body as { frequency?: unknown }).frequency;
  const allergies = (body as { allergies?: unknown }).allergies;
  const companionMedicines = (body as { companionMedicines?: unknown }).companionMedicines;
  const nomorObat = (body as { nomorObat?: unknown }).nomorObat;
  const quantity = (body as { quantity?: unknown }).quantity;
  const diagnosisSummary = (body as { diagnosisSummary?: unknown }).diagnosisSummary;
  const activeMedicines = (body as { activeMedicines?: unknown }).activeMedicines;

  const normalizedMedicineName = typeof medicineName === "string" ? medicineName.trim() : "";
  const normalizedDosage = typeof dosage === "string" ? dosage.trim() : "";
  const normalizedFrequency = typeof frequency === "string" ? frequency.trim() : "";
  const normalizedAllergies = typeof allergies === "string" ? allergies.trim() : "";
  const normalizedCompanionMedicines =
    typeof companionMedicines === "string" ? companionMedicines.trim() : "";
  const normalizedNomorObat = typeof nomorObat === "string" ? nomorObat.trim().toUpperCase() : "";
  const normalizedDiagnosisSummary =
    typeof diagnosisSummary === "string" ? diagnosisSummary.trim() : "";
  const normalizedActiveMedicines =
    typeof activeMedicines === "string" ? activeMedicines.trim() : "";
  const normalizedQuantity =
    typeof quantity === "number" && Number.isFinite(quantity)
      ? Math.max(1, Math.round(quantity))
      : 1;

  if (normalizedMedicineName.length < 2 || normalizedMedicineName.length > 120) {
    return NextResponse.json({ error: "Nama obat wajib diisi." }, { status: 400 });
  }

  if (normalizedDosage.length > 120) {
    return NextResponse.json({ error: "Dosis terlalu panjang." }, { status: 400 });
  }

  if (normalizedFrequency.length > 80) {
    return NextResponse.json({ error: "Frekuensi terlalu panjang." }, { status: 400 });
  }

  if (normalizedAllergies.length > 300) {
    return NextResponse.json({ error: "Data alergi terlalu panjang." }, { status: 400 });
  }

  if (normalizedCompanionMedicines.length > 300) {
    return NextResponse.json({ error: "Data obat pendamping terlalu panjang." }, { status: 400 });
  }

  if (normalizedNomorObat.length > 32) {
    return NextResponse.json({ error: "Nomor obat terlalu panjang." }, { status: 400 });
  }

  if (normalizedDiagnosisSummary.length > 400) {
    return NextResponse.json({ error: "Ringkasan diagnosis terlalu panjang." }, { status: 400 });
  }

  if (normalizedActiveMedicines.length > 400) {
    return NextResponse.json({ error: "Data obat aktif terlalu panjang." }, { status: 400 });
  }

  const result = await validatePrescription({
    medicineName: normalizedMedicineName,
    dosage: normalizedDosage,
    frequency: normalizedFrequency,
    allergies: normalizedAllergies,
    companionMedicines: normalizedCompanionMedicines,
    nomorObat: normalizedNomorObat || undefined,
    quantity: normalizedQuantity,
    diagnosisSummary: normalizedDiagnosisSummary || undefined,
    activeMedicines: normalizedActiveMedicines || undefined,
  });

  await logActivitySafe({
    module: "APOTEKER",
    action: "PRESCRIPTION_VALIDATED",
    detail: `Validasi resep untuk ${normalizedMedicineName} selesai dengan status ${
      result.canProceed ? "aman" : "butuh_tindak_lanjut"
    }.`,
    user: { id: user.id, name: user.name, role: user.role },
    request,
  });

  return NextResponse.json({ result });
}
