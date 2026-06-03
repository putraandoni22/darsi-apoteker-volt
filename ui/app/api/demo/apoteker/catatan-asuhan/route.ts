import { NextResponse, type NextRequest } from "next/server";
import { logActivitySafe } from "@/lib/activity/store";
import { getApiAuthenticatedUser } from "@/lib/auth/guards";
import {
  CatatanAsuhanApotekerError,
  createCatatanAsuhanApoteker,
  listCatatanAsuhanApoteker,
} from "@/lib/demo/asuhan-apoteker-store";

export const dynamic = "force-dynamic";

function isValidNomorRM(value: string): boolean {
  return /^[A-Z0-9-]{3,32}$/.test(value);
}

export async function GET(request: NextRequest) {
  const user = await getApiAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "admin" && user.role !== "apoteker") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const nomorRMRaw = request.nextUrl.searchParams.get("nomorRM")?.trim().toUpperCase() ?? "";
  const obatIdRaw = request.nextUrl.searchParams.get("obatId")?.trim() ?? "";

  if (nomorRMRaw && !isValidNomorRM(nomorRMRaw)) {
    return NextResponse.json({ error: "Format nomor RM tidak valid." }, { status: 400 });
  }

  let obatId: number | undefined;
  if (obatIdRaw) {
    const parsed = Number.parseInt(obatIdRaw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return NextResponse.json({ error: "Parameter obatId tidak valid." }, { status: 400 });
    }
    obatId = parsed;
  }

  const records = await listCatatanAsuhanApoteker({
    nomorRM: nomorRMRaw || undefined,
    obatId,
  });

  return NextResponse.json({
    records,
    filters: {
      nomorRM: nomorRMRaw,
      obatId: obatId ?? null,
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
    return NextResponse.json({ error: "Request body tidak valid." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body tidak valid." }, { status: 400 });
  }

  const nomorRMRaw =
    typeof (body as { nomorRM?: unknown }).nomorRM === "string"
      ? (body as { nomorRM: string }).nomorRM.trim().toUpperCase()
      : "";
  const obatIdRaw = (body as { obatId?: unknown }).obatId;
  const catatanRaw =
    typeof (body as { catatan?: unknown }).catatan === "string"
      ? (body as { catatan: string }).catatan.trim()
      : "";

  if (!isValidNomorRM(nomorRMRaw)) {
    return NextResponse.json({ error: "Nomor RM tidak valid." }, { status: 400 });
  }

  const obatId =
    typeof obatIdRaw === "number"
      ? obatIdRaw
      : typeof obatIdRaw === "string"
        ? Number.parseInt(obatIdRaw, 10)
        : Number.NaN;

  if (!Number.isInteger(obatId) || obatId <= 0) {
    return NextResponse.json({ error: "obatId wajib berupa integer positif." }, { status: 400 });
  }

  if (!catatanRaw) {
    return NextResponse.json({ error: "Catatan wajib diisi." }, { status: 400 });
  }

  if (catatanRaw.length > 2000) {
    return NextResponse.json({ error: "Catatan terlalu panjang (maksimal 2000 karakter)." }, { status: 400 });
  }

  try {
    const record = await createCatatanAsuhanApoteker({
      nomorRM: nomorRMRaw,
      obatId,
      catatan: catatanRaw,
    });

    await logActivitySafe({
      module: "APOTEKER",
      action: "CATATAN_ASUHAN_CREATED",
      detail: `Catatan asuhan untuk ${nomorRMRaw} dibuat dengan obat_id ${obatId}.`,
      user: { id: user.id, name: user.name, role: user.role },
      request,
    });

    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    if (error instanceof CatatanAsuhanApotekerError) {
      const status = error.code === "obat_not_found" ? 404 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }

    throw error;
  }
}
