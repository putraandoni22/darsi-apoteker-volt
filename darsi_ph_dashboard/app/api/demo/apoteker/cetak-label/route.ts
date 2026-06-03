import { NextResponse, type NextRequest } from "next/server";
import { getApiAuthenticatedUser } from "@/lib/auth/guards";
import { logActivitySafe } from "@/lib/activity/store";
import { createLabelPreview } from "@/lib/demo/store";

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

  const patientName = (body as { patientName?: unknown }).patientName;
  const medicineName = (body as { medicineName?: unknown }).medicineName;
  const dosage = (body as { dosage?: unknown }).dosage;
  const duration = (body as { duration?: unknown }).duration;
  const instructions = (body as { instructions?: unknown }).instructions;

  const normalizedPatientName = typeof patientName === "string" ? patientName.trim() : "";
  const normalizedMedicineName = typeof medicineName === "string" ? medicineName.trim() : "";
  const normalizedDosage = typeof dosage === "string" ? dosage.trim() : "";
  const normalizedDuration = typeof duration === "string" ? duration.trim() : "";
  const normalizedInstructions = typeof instructions === "string" ? instructions.trim() : "";

  if (normalizedPatientName.length < 2 || normalizedPatientName.length > 80) {
    return NextResponse.json({ error: "Nama pasien wajib diisi." }, { status: 400 });
  }

  if (normalizedMedicineName.length < 2 || normalizedMedicineName.length > 120) {
    return NextResponse.json({ error: "Nama obat wajib diisi." }, { status: 400 });
  }

  if (normalizedDosage.length < 2 || normalizedDosage.length > 120) {
    return NextResponse.json({ error: "Dosis/aturan pakai wajib diisi." }, { status: 400 });
  }

  if (normalizedDuration.length > 40) {
    return NextResponse.json({ error: "Durasi terlalu panjang." }, { status: 400 });
  }

  if (normalizedInstructions.length > 240) {
    return NextResponse.json({ error: "Instruksi tambahan terlalu panjang." }, { status: 400 });
  }

  const label = createLabelPreview({
    patientName: normalizedPatientName,
    medicineName: normalizedMedicineName,
    dosage: normalizedDosage,
    duration: normalizedDuration,
    instructions: normalizedInstructions,
  });

  await logActivitySafe({
    module: "APOTEKER",
    action: "LABEL_GENERATED",
    detail: `Label ${label.labelId} dibuat untuk pasien ${normalizedPatientName}.`,
    user: { id: user.id, name: user.name, role: user.role },
    request,
  });

  return NextResponse.json({ label });
}
