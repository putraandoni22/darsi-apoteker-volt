import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ArrowRight } from "lucide-react";
import { DarsiLogo } from "@/components/branding/darsi-logo";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { getDashboardPathForRole } from "@/lib/auth/routing";
import { getCurrentUserFromCookies } from "@/lib/auth/session";
import { RoleSelectorClient } from "@/components/auth/role-selector-client";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
});

const roleCards = [
  {
    role: "DARSI Customer Service",
    badge: "Koordinasi Pasien",
    points: [
      "Membantu frontliner menjawab pertanyaan pasien secara cepat, konsisten, dan terdokumentasi.",
      "Menghubungkan pertanyaan layanan ke unit terkait agar alur pasien tidak terputus.",
    ],
  },
  {
    role: "DARSI Doctor",
    badge: "Dukungan Klinik",
    points: [
      "Menyajikan referensi terapi dan informasi obat yang relevan untuk pengambilan keputusan klinis.",
      "Mendukung sinkronisasi instruksi terapi ke perawat, apoteker, dan unit administrasi.",
    ],
  },
  {
    role: "DARSI Nurse",
    badge: "Pendamping Perawatan",
    points: [
      "Membantu verifikasi jadwal obat, instruksi tindak lanjut, dan pemantauan kepatuhan terapi pasien.",
      "Memastikan komunikasi perawatan lintas shift tetap jelas dan terstandar.",
    ],
  },
  {
    role: "DARSI Pharmacy",
    badge: "Operasional Farmasi",
    points: [
      "Mendukung validasi resep, dispensing, dan monitoring stok obat secara lebih aman dan cepat.",
      "Menyambungkan proses farmasi dengan dashboard admin dan status layanan pasien.",
    ],
  },
];

const quickStats = [
  { value: "4 Role", label: "Customer Service • Doctor • Nurse • Pharmacy" },
  { value: "Integrasi Cerdas", label: "Menghubungkan Data & Layanan RSI" },
  { value: "on-premise", label: "Cepat • Akurat • Aman untuk RSI" },
];

export default async function Home() {
  const user = await getCurrentUserFromCookies();

  if (user) {
    redirect(getDashboardPathForRole(user.role));
  }

  return (
    <main
      className={`${plusJakarta.variable} relative min-h-dvh overflow-x-clip bg-[#f4fbf6] font-[var(--font-plus-jakarta)] text-[#163228] transition-colors dark:bg-[#030906] dark:text-[#e6f7ec]`}
    >
      <div className="pointer-events-none absolute -left-16 top-16 h-72 w-72 rounded-full bg-emerald-200/40 blur-3xl dark:bg-emerald-500/18" />
      <div className="pointer-events-none absolute -right-20 top-36 h-80 w-80 rounded-full bg-green-200/35 blur-3xl dark:bg-green-600/16" />
      <div className="pointer-events-none absolute bottom-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-emerald-100/50 blur-3xl dark:bg-emerald-400/8" />

      <section className="relative z-10 mx-auto max-w-6xl px-4 pb-10 pt-4 md:px-8 md:pt-8">
        <p className="rounded-full bg-emerald-700 px-4 py-1 text-center font-semibold text-[10px] tracking-[0.18em] text-emerald-50 md:text-[11px]">
          PLATFORM DIGITAL RSI SURABAYA
        </p>

        <header className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-emerald-200/80 bg-white/90 px-5 py-4 shadow-[0_18px_38px_-26px_rgba(6,95,70,0.35)] backdrop-blur-xl dark:border-emerald-900/70 dark:bg-[#07110c]/88">
          <div className="flex items-center gap-3">
            <DarsiLogo
              size={38}
              titleClassName="text-[18px]"
              subtitleClassName="text-emerald-700/85 dark:text-emerald-300/85"
            />
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <RoleSelectorClient variant="header" />
          </div>
        </header>

        <section className="mt-12 text-center" id="tentang">
          <p className="inline-flex rounded-full border border-emerald-200 bg-emerald-100/80 px-4 py-1 font-semibold text-[11px] tracking-[0.14em] text-emerald-800 uppercase dark:border-emerald-700 dark:bg-emerald-900/25 dark:text-emerald-200">
            Fokus merawat, biar sistem yang mencatat
          </p>

          <h1 className="mx-auto mt-5 max-w-4xl bg-gradient-to-r from-emerald-600 via-green-500 to-lime-500 bg-clip-text font-extrabold text-5xl leading-tight tracking-tight text-transparent md:text-7xl dark:from-emerald-300 dark:via-green-300 dark:to-lime-300">
            DARSI
          </h1>

          <p className="mx-auto mt-2 max-w-4xl font-extrabold text-4xl leading-tight tracking-tight text-emerald-900 md:text-6xl dark:text-emerald-100">
            Digital Assistant for RSI
          </p>

          <p className="mx-auto mt-5 max-w-3xl text-base leading-relaxed text-emerald-900/70 dark:text-emerald-100/70">
            Platform AI terintegrasi yang dirancang khusus untuk mendukung tenaga kesehatan di RSI
            Surabaya. DARSI membantu menyederhanakan operasional rumah sakit, mulai dari manajemen
            farmasi hingga administrasi klaim, melalui teknologi AI lokal yang cepat, akurat, dan
            terjamin keamanannya.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <RoleSelectorClient variant="cta" />
          </div>

          <div className="mx-auto mt-10 grid w-full max-w-3xl gap-3 rounded-[28px] border border-emerald-200/80 bg-white/75 p-4 shadow-[0_18px_36px_-26px_rgba(6,95,70,0.35)] backdrop-blur md:grid-cols-3 dark:border-emerald-900/70 dark:bg-[#07110c]/70">
            {quickStats.map((item) => (
              <div key={item.label} className="rounded-2xl bg-white/90 p-4 dark:bg-[#0c1812]">
                <p className="font-extrabold text-2xl tracking-tight">{item.value}</p>
                <p className="mt-1 text-xs tracking-[0.08em] text-emerald-900/65 uppercase dark:text-emerald-100/60">
                  {item.label}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section
          id="akses"
          className="mt-14 rounded-[34px] border border-emerald-200/80 bg-white/75 px-5 py-8 shadow-[0_18px_40px_-28px_rgba(6,95,70,0.35)] backdrop-blur md:px-7 dark:border-emerald-900/70 dark:bg-[#07110c]/70"
        >
          <p className="text-center font-semibold text-[11px] tracking-[0.16em] text-emerald-800 uppercase dark:text-emerald-300">
            Layanan
          </p>
          <h2 className="mt-2 text-center font-bold text-3xl tracking-tight md:text-4xl">
            4 Role Utama DARSI
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-emerald-900/65 dark:text-emerald-100/70">
            Penjelasan singkat peran utama DARSI untuk alur layanan lintas tim di RSI.
          </p>

          <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {roleCards.map((item) => (
              <article
                key={item.role}
                className="rounded-3xl border border-emerald-200/80 bg-white/90 p-5 shadow-sm dark:border-emerald-900/80 dark:bg-[#0a1611]/85"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold text-xl tracking-tight">{item.role}</h3>
                  <span className="rounded-full border border-emerald-200 bg-emerald-100 px-3 py-1 font-semibold text-[10px] tracking-[0.08em] text-emerald-800 uppercase dark:border-emerald-700 dark:bg-emerald-900/35 dark:text-emerald-200">
                    {item.badge}
                  </span>
                </div>

                <ul className="mt-4 space-y-2 text-sm text-emerald-950/75 dark:text-emerald-100/75">
                  {item.points.map((point) => (
                    <li key={point} className="flex items-start gap-2">
                      <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-300" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <footer className="mt-10 flex flex-col items-center justify-between gap-3 rounded-3xl border border-emerald-200/80 bg-white/75 px-5 py-4 text-xs tracking-[0.1em] text-emerald-900/65 uppercase md:flex-row dark:border-emerald-900/70 dark:bg-[#07110c]/70 dark:text-emerald-100/65">
          <p>DARSI | Digital Assistant for RSI</p>
          <p>Enkripsi aktif • Akses role-based</p>
        </footer>
      </section>
    </main>
  );
}
