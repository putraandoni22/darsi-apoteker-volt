import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const promptHistory = [
  {
    time: "11 Apr 2026 09:44",
    role: "apoteker",
    prompt: "Cek interaksi amlodipine dengan simvastatin untuk pasien usia lanjut.",
    response: "AI memberi warning interaksi dan saran monitoring efek samping.",
    latency: 1.8,
  },
  {
    time: "11 Apr 2026 09:32",
    role: "admin",
    prompt: "Tampilkan ringkasan stok kritis hari ini.",
    response: "AI menampilkan daftar obat kritis dan prioritas restok.",
    latency: 1.2,
  },
  {
    time: "11 Apr 2026 09:18",
    role: "apoteker",
    prompt: "Validasi dosis pediatrik untuk amoksisilin 125 mg/5 ml.",
    response: "AI memberi rekomendasi dosis berdasarkan berat badan.",
    latency: 2.1,
  },
  {
    time: "11 Apr 2026 08:57",
    role: "pasien",
    prompt: "Cara minum obat hipertensi saya kapan?",
    response: "AI memberi jadwal konsumsi sesuai etiket yang tersimpan.",
    latency: 0.9,
  },
];

function latencyBadgeClass(latency: number): string {
  if (latency <= 1.5) {
    return "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200";
  }

  if (latency <= 2.5) {
    return "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
  }

  return "border-rose-200 bg-rose-100 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200";
}

export default function AdminLlmAnalyticsPage() {
  const averageLatency =
    promptHistory.reduce((total, item) => total + item.latency, 0) / promptHistory.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">Pemantauan Performa LLM</h1>
        <p className="text-muted-foreground text-sm">
          Audit prompt-respons AI dan metrik performa model lokal untuk validasi mutu layanan.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Prompt Hari Ini</CardDescription>
            <CardTitle className="text-2xl">{promptHistory.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Rata-rata Latency</CardDescription>
            <CardTitle className="text-2xl">{averageLatency.toFixed(2)} dtk</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>GPU Utilization</CardDescription>
            <CardTitle className="text-2xl">64%</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>NVMe I/O</CardDescription>
            <CardTitle className="text-2xl">Sehat</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat Prompt & Respons</CardTitle>
          <CardDescription>
            Digunakan untuk audit jika ada dugaan kesalahan informasi medis.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {promptHistory.map((item) => (
            <div key={`${item.time}-${item.prompt}`} className="rounded-lg border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-sm">{item.role.toUpperCase()}</p>
                <Badge className={latencyBadgeClass(item.latency)}>{item.latency.toFixed(2)} dtk</Badge>
                <span className="text-muted-foreground text-xs">{item.time}</span>
              </div>
              <p className="mt-2 text-sm"><span className="font-medium">Prompt:</span> {item.prompt}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                <span className="font-medium text-foreground">Respons:</span> {item.response}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
