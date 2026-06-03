import { type NextRequest, NextResponse } from "next/server";
import { getApiAuthenticatedUser } from "@/lib/auth/guards";
import { listPatientPrescriptionPayments } from "@/lib/demo/store";

export const dynamic = "force-dynamic";

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

  const nomorPeresepan =
    request.nextUrl.searchParams.get("nomorPeresepan")?.trim().toUpperCase() ?? "";

  if (nomorPeresepan.length > 0 && !isValidNomorPeresepan(nomorPeresepan)) {
    return NextResponse.json(
      { error: "Format nomor peresepan tidak valid." },
      { status: 400 },
    );
  }

  const prescriptions = await listPatientPrescriptionPayments({
    nomorPeresepan: nomorPeresepan || undefined,
  });

  return NextResponse.json({
    prescriptions,
    filters: {
      nomorPeresepan,
    },
  });
}
