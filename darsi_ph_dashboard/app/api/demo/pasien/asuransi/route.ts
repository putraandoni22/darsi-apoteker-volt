import { NextResponse, type NextRequest } from "next/server";
import { getApiAuthenticatedUser } from "@/lib/auth/guards";
import { logActivitySafe } from "@/lib/activity/store";
import { checkInsurance } from "@/lib/demo/store";
import type { DemoInsuranceProvider } from "@/lib/demo/types";

export const dynamic = "force-dynamic";

function isInsuranceProvider(value: unknown): value is DemoInsuranceProvider {
  return value === "bpjs" || value === "swasta";
}

export async function GET(request: NextRequest) {
  const user = await getApiAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "pasien") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    providers: [
      { value: "bpjs", label: "BPJS" },
      { value: "swasta", label: "Asuransi Swasta" },
    ],
    notes: "Hasil adalah simulasi untuk kebutuhan demo.",
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

  const provider = (body as { provider?: unknown }).provider;
  const memberId = (body as { memberId?: unknown }).memberId;
  const serviceType = (body as { serviceType?: unknown }).serviceType;

  const normalizedMemberId = typeof memberId === "string" ? memberId.trim() : "";
  const normalizedServiceType = typeof serviceType === "string" ? serviceType.trim() : "";

  if (!isInsuranceProvider(provider)) {
    return NextResponse.json({ error: "Provider asuransi tidak valid." }, { status: 400 });
  }

  if (normalizedMemberId.length < 8 || normalizedMemberId.length > 32) {
    return NextResponse.json({ error: "Nomor peserta/polis tidak valid." }, { status: 400 });
  }

  if (!/^[a-zA-Z0-9-]+$/.test(normalizedMemberId)) {
    return NextResponse.json(
      { error: "Nomor peserta/polis hanya boleh berisi huruf, angka, atau strip." },
      { status: 400 },
    );
  }

  if (normalizedServiceType.length < 3 || normalizedServiceType.length > 80) {
    return NextResponse.json({ error: "Jenis layanan wajib diisi." }, { status: 400 });
  }

  const result = checkInsurance({
    provider,
    memberId: normalizedMemberId,
    serviceType: normalizedServiceType,
  });

  await logActivitySafe({
    module: "PASIEN",
    action: "INSURANCE_CHECKED",
    detail: `Cek asuransi ${provider.toUpperCase()} untuk layanan ${normalizedServiceType} berhasil diproses.`,
    user: { id: user.id, name: user.name, role: user.role },
    request,
  });

  return NextResponse.json({ result });
}
