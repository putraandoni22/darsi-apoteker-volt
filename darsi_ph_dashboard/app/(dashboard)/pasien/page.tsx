import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const modules = [
  {
    title: "Asisten Obat",
    description: "Konsultasi pertanyaan obat, aturan pakai, dan edukasi terapi.",
    href: "/pasien/asisten-obat",
  },
  {
    title: "Pusat Informasi Obat",
    description: "Lihat panduan obat aktif, peringatan, dan status stok resep.",
    href: "/pasien/informasi-obat",
  },
  {
    title: "Pembayaran & Konfirmasi Resep",
    description: "Konfirmasi pembayaran agar resep langsung diproses tim apotek.",
    href: "/pasien/pembayaran",
  },
  {
    title: "Pelacakan Status Peracikan",
    description: "Pantau progres tiap obat dari validasi hingga siap diserahkan.",
    href: "/pasien/pelacakan-status",
  },
  {
    title: "Riwayat Transaksi & Medikasi",
    description: "Riwayat pembayaran resep dan rekam medikasi yang telah diproses.",
    href: "/pasien/riwayat-transaksi",
  },
];

export default function PasienOverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">Dashboard Pasien</h1>
        <p className="text-muted-foreground text-sm">
          Ringkasan layanan pasien untuk pemantauan resep, medikasi, dan komunikasi dengan apoteker.
        </p>
      </div>

      <Card className="border-emerald-200/80 bg-emerald-50/40 dark:border-emerald-900/80 dark:bg-emerald-950/20">
        <CardHeader>
          <CardTitle>Alur Layanan Pasien</CardTitle>
          <CardDescription>
            Mulai dari pembayaran resep, lanjut pantau status peracikan, lalu tinjau riwayat medikasi.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>1. Konfirmasi tagihan resep di menu Pembayaran & Konfirmasi Resep.</p>
          <p>2. Pantau progres peracikan pada menu Pelacakan Status Peracikan.</p>
          <p>3. Cek histori transaksi dan medikasi pada menu Riwayat Transaksi & Medikasi.</p>
          <p>4. Gunakan Asisten Obat dan Pusat Informasi Obat untuk edukasi terapi harian.</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {modules.map((item) => (
          <Card key={item.title} className="border-emerald-200/80 bg-white/95 dark:border-emerald-900/80 dark:bg-[#0f1a15]">
            <CardHeader>
              <CardTitle>{item.title}</CardTitle>
              <CardDescription>{item.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                asChild
                className="bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:from-emerald-400 hover:to-green-500"
              >
                <Link href={item.href}>Buka Modul</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
