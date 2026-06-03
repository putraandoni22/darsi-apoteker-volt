import { NextResponse, type NextRequest } from "next/server";
import { getApiAuthenticatedUser } from "@/lib/auth/guards";
import {
  listPatientMedicineInfo,
  listPatientMedicineInfoByPrescriptionNumber,
  listPatientReceivedMedicineInfo,
} from "@/lib/demo/store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getApiAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "pasien") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const nomorPeresepan = request.nextUrl.searchParams.get("nomorPeresepan")?.trim() ?? "";
  const hanyaDiterima =
    request.nextUrl.searchParams.get("hanyaDiterima")?.trim().toLowerCase() === "true";

  const patientFilters = {
    patientUserId: user.id,
    patientNomorRM: user.nomorRM ?? undefined,
    patientName: user.name,
  };

  const medicines = hanyaDiterima
    ? await listPatientReceivedMedicineInfo({
        ...patientFilters,
        nomorPeresepan: nomorPeresepan || undefined,
      })
    : nomorPeresepan
      ? await listPatientMedicineInfoByPrescriptionNumber(nomorPeresepan)
      : await listPatientMedicineInfo();

  return NextResponse.json({
    medicines,
    filters: {
      nomorPeresepan,
      hanyaDiterima,
    },
  });
}
