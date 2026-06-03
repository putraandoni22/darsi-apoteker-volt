import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const numberingRules = [
  {
    source: "OBAT_ID",
    target: "OBAT_KODE",
    pattern: "0000 + nomor urut",
    sample: "OBAT_ID 39 -> OBT-0039",
  },
  {
    source: "NOMOR_RESEP",
    target: "NOMOR_PERESEPAN",
    pattern: "RSP-YYYYMMDD-XXXXXX",
    sample: "11/04/2026 -> RSP-20260411-00A1B2",
  },
  {
    source: "PASIEN_ID",
    target: "NOMOR_RM",
    pattern: "RM-XXXXX",
    sample: "PASIEN 2 -> RM-00002",
  },
];

const referenceTables = [
  {
    name: "Master ICD-10",
    description: "Kode penyakit untuk referensi diagnosis klinis.",
    lastSync: "10 Apr 2026",
    status: "Aktif",
  },
  {
    name: "Master Klaim BPJS",
    description: "Referensi aturan klaim untuk kebutuhan administrasi.",
    lastSync: "09 Apr 2026",
    status: "Aktif",
  },
  {
    name: "Pemetaan Obat Internal RSI",
    description: "Relasi data obat kronis internal dengan katalog e-Fornas.",
    lastSync: "11 Apr 2026",
    status: "Aktif",
  },
];

export default function AdminMasterDataMappingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">Manajemen Master Data & Mapping</h1>
        <p className="text-muted-foreground text-sm">
          Atur aturan penomoran dan tabel referensi dasar agar sinkronisasi data tetap konsisten.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Aturan Penomoran</CardTitle>
          <CardDescription>
            Konfigurasi mapping kode utama yang dipakai lintas modul DARSI.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-muted/60">
                <tr>
                  <th className="px-3 py-2">Sumber</th>
                  <th className="px-3 py-2">Target</th>
                  <th className="px-3 py-2">Pola</th>
                  <th className="px-3 py-2">Contoh</th>
                </tr>
              </thead>
              <tbody>
                {numberingRules.map((rule) => (
                  <tr key={rule.source} className="border-t">
                    <td className="px-3 py-2 font-medium">{rule.source}</td>
                    <td className="px-3 py-2">{rule.target}</td>
                    <td className="px-3 py-2">{rule.pattern}</td>
                    <td className="px-3 py-2">{rule.sample}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button className="bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:from-emerald-400 hover:to-green-500">
              Tambah Aturan
            </Button>
            <Button variant="outline">Ubah Aturan</Button>
            <Button variant="outline">Uji Mapping</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Master Data ICD & BPJS</CardTitle>
          <CardDescription>
            Tabel referensi yang bisa diperbarui saat ada perubahan regulasi.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {referenceTables.map((table) => (
            <div key={table.name} className="rounded-lg border border-border bg-card px-4 py-3">
              <p className="font-medium text-sm">{table.name}</p>
              <p className="text-muted-foreground mt-1 text-xs">{table.description}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Update terakhir {table.lastSync} • Status {table.status}
              </p>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline">Sinkronkan Referensi</Button>
            <Button variant="outline">Import Master Data</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
