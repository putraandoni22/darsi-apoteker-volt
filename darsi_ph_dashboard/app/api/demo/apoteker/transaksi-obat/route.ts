import { NextResponse, type NextRequest } from "next/server";
import { getApiAuthenticatedUser } from "@/lib/auth/guards";
import { listMedicineTransactions } from "@/lib/demo/store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getApiAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "admin" && user.role !== "apoteker") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const nomorObatQuery = request.nextUrl.searchParams.get("nomorObat")?.trim() ?? "";
  const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
  const limitRaw = request.nextUrl.searchParams.get("limit")?.trim() ?? "";

  const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : Number.NaN;
  if (limitRaw && (!Number.isFinite(parsedLimit) || parsedLimit <= 0)) {
    return NextResponse.json({ error: "Parameter limit tidak valid." }, { status: 400 });
  }

  const transactions = await listMedicineTransactions({
    nomorObatQuery,
    query,
    limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
  });

  return NextResponse.json({
    transactions,
    filters: {
      nomorObat: nomorObatQuery,
      query,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : null,
    },
  }, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
