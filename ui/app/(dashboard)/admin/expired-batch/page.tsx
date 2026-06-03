import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listStockItems } from "@/lib/demo/store";
import type { DemoStockItem } from "@/lib/demo/types";

interface BatchInsight {
  id: string;
  nomorObat: string;
  nama: string;
  batchCode: string;
  expiredAt: string;
  status: "kedaluwarsa" | "h90";
  daysLeft: number;
  lokasi: string;
}

function parseExpiryDate(value: string): Date | null {
  const normalized = value.trim();
  if (!normalized || normalized.toUpperCase() === "N/A") {
    return null;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function deriveBatchCode(item: DemoStockItem): string {
  const rawId = item.id.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(-6);
  const rawNomor = (item.nomorObat ?? "OBAT").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(-4);
  return `BTH-${rawNomor}-${rawId || "000000"}`;
}

function buildInsight(item: DemoStockItem, today: Date): BatchInsight | null {
  const expiryDate = parseExpiryDate(item.expiredAt);
  if (!expiryDate) {
    return null;
  }

  const diffMs = expiryDate.getTime() - today.getTime();
  const daysLeft = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (daysLeft > 90) {
    return null;
  }

  return {
    id: item.id,
    nomorObat: item.nomorObat ?? "-",
    nama: item.nama,
    batchCode: deriveBatchCode(item),
    expiredAt: item.expiredAt,
    status: daysLeft < 0 ? "kedaluwarsa" : "h90",
    daysLeft,
    lokasi: item.lokasi,
  };
}

export default async function AdminExpiredBatchPage() {
  const today = new Date();
  const normalizedToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const stockItems = await listStockItems({ includeCatalog: true });
  const insights = stockItems
    .map((item) => buildInsight(item, normalizedToday))
    .filter((item): item is BatchInsight => Boolean(item))
    .sort((first, second) => first.daysLeft - second.daysLeft);

  const expiredCount = insights.filter((item) => item.status === "kedaluwarsa").length;
  const h90Count = insights.filter((item) => item.status === "h90").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">Manajemen Expired & Batch Obat</h1>
        <p className="text-muted-foreground text-sm">
          Pantau batch obat yang mendekati kedaluwarsa agar indikator stok kritis lebih akurat.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Batch Dipantau</CardDescription>
            <CardTitle className="text-2xl">{insights.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Batch Kedaluwarsa</CardDescription>
            <CardTitle className="text-2xl">{expiredCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Batch H-90</CardDescription>
            <CardTitle className="text-2xl">{h90Count}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Prioritas Tindakan</CardDescription>
            <CardTitle className="text-2xl">{expiredCount + h90Count}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Batch Kritis Kedaluwarsa</CardTitle>
          <CardDescription>
            Prioritaskan redistribusi atau pengadaan ulang untuk batch dengan sisa hari terendah.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-muted/60">
                <tr>
                  <th className="px-3 py-2">Batch</th>
                  <th className="px-3 py-2">Nomor Obat</th>
                  <th className="px-3 py-2">Nama Obat</th>
                  <th className="px-3 py-2">Kadaluarsa</th>
                  <th className="px-3 py-2">Sisa Hari</th>
                  <th className="px-3 py-2">Lokasi</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {insights.length === 0 ? (
                  <tr className="border-t">
                    <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      Tidak ada batch dengan rentang H-90 atau sudah kedaluwarsa.
                    </td>
                  </tr>
                ) : (
                  insights.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">{item.batchCode}</td>
                      <td className="px-3 py-2 font-mono">{item.nomorObat}</td>
                      <td className="px-3 py-2">{item.nama}</td>
                      <td className="px-3 py-2">{item.expiredAt}</td>
                      <td className="px-3 py-2">
                        {item.daysLeft < 0 ? `Lewat ${Math.abs(item.daysLeft)} hari` : `${item.daysLeft} hari`}
                      </td>
                      <td className="px-3 py-2">{item.lokasi || "-"}</td>
                      <td className="px-3 py-2">
                        {item.status === "kedaluwarsa" ? (
                          <Badge className="border-rose-200 bg-rose-100 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                            Kedaluwarsa
                          </Badge>
                        ) : (
                          <Badge className="border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                            H-90
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
