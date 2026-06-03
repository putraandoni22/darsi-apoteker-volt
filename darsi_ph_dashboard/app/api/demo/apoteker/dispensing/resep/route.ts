import { NextResponse, type NextRequest } from "next/server";
import { getApiAuthenticatedUser } from "@/lib/auth/guards";
import { DispensingPrescriptionError, getDispensingPrescriptionLookup } from "@/lib/demo/store";

export const dynamic = "force-dynamic";

function isValidNomorRM(value: string): boolean {
  return /^[A-Z0-9-]{3,32}$/.test(value);
}

function isValidNomorPeresepan(value: string): boolean {
  return /^[A-Z0-9-]{5,40}$/.test(value);
}

export async function GET(request: NextRequest) {
  const user = await getApiAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "admin" && user.role !== "apoteker") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const nomorRM = request.nextUrl.searchParams.get("nomorRM")?.trim().toUpperCase() ?? "";
  const nomorPeresepan =
    request.nextUrl.searchParams.get("nomorPeresepan")?.trim().toUpperCase() ?? "";

  if (nomorRM.length > 0 && !isValidNomorRM(nomorRM)) {
    return NextResponse.json({ error: "Format nomor RM tidak valid." }, { status: 400 });
  }

  if (!nomorPeresepan) {
    return NextResponse.json({ error: "Nomor peresepan wajib diisi." }, { status: 400 });
  }

  if (!isValidNomorPeresepan(nomorPeresepan)) {
    return NextResponse.json({ error: "Format nomor peresepan tidak valid." }, { status: 400 });
  }

  try {
    const prescription = await getDispensingPrescriptionLookup(nomorRM || undefined, nomorPeresepan);
    return NextResponse.json({ prescription });
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

    throw error;
  }
}