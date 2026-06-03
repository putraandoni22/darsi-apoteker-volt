"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  DemoDispensingWorkflowStatus,
  DemoPatientMedicineInfo,
} from "@/lib/demo/types";

interface MedicinesResponse {
  medicines: DemoPatientMedicineInfo[];
  filters?: {
    nomorPeresepan?: string;
    hanyaDiterima?: boolean;
  };
}

function isNeedAttentionStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized.includes("kritis") || normalized.includes("terbatas");
}

function stockBadgeClassName(status: string): string {
  const normalized = status.toLowerCase();

  if (normalized.includes("kritis")) {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200";
  }

  if (normalized.includes("terbatas")) {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200";
}

function dispensingWorkflowBadge(status: DemoDispensingWorkflowStatus): {
  text: string;
  className: string;
} {
  if (status === "diserahkan") {
    return {
      text: "Sudah Diserahkan",
      className:
        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
    };
  }

  if (status === "siap_diserahkan") {
    return {
      text: "Siap Diserahkan",
      className:
        "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200",
    };
  }

  if (status === "sedang_diracik") {
    return {
      text: "Sedang Diracik",
      className:
        "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
    };
  }

  if (status === "siap_diracik") {
    return {
      text: "Siap Diracik",
      className:
        "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-200",
    };
  }

  if (status === "menunggu_validasi_resep") {
    return {
      text: "Menunggu Validasi Resep",
      className:
        "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200",
    };
  }

  if (status === "cancel") {
    return {
      text: "Dibatalkan",
      className:
        "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200",
    };
  }

  return {
    text: "Menunggu Pembayaran",
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  };
}

function isValidPrescriptionNumber(value: string): boolean {
  if (value.trim().length === 0) {
    return true;
  }

  return /^[A-Z0-9-]{5,40}$/.test(value.trim().toUpperCase());
}

export default function PasienInformasiObatPage() {
  const [medicines, setMedicines] = useState<DemoPatientMedicineInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [nomorPeresepanInput, setNomorPeresepanInput] = useState("");
  const [nomorPeresepanQuery, setNomorPeresepanQuery] = useState("");
  const noReceivedMedicinesMessage = "belum ada obat yang di terima";

  const loadMedicines = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const params = new URLSearchParams();
      params.set("hanyaDiterima", "true");
      if (nomorPeresepanQuery.trim()) {
        params.set("nomorPeresepan", nomorPeresepanQuery.trim().toUpperCase());
      }

      const queryString = params.toString();
      const targetUrl = queryString
        ? `/api/demo/pasien/informasi-obat?${queryString}`
        : "/api/demo/pasien/informasi-obat";

      const response = await fetch(targetUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Gagal mengambil informasi obat.");
      }

      const payload = (await response.json()) as MedicinesResponse;
      setMedicines(payload.medicines);
      setNomorPeresepanInput(payload.filters?.nomorPeresepan ?? nomorPeresepanQuery);
      setLastUpdatedAt(new Date().toISOString());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Terjadi kesalahan.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, [nomorPeresepanQuery]);

  useEffect(() => {
    void loadMedicines();
  }, [loadMedicines]);

  const summary = useMemo(() => {
    const activeCount = medicines.length;
    const needsAttentionCount = medicines.filter((item) =>
      isNeedAttentionStatus(item.stokStatus)
    ).length;
    const controlledCount = Math.max(activeCount - needsAttentionCount, 0);
    const readinessPercent =
      activeCount === 0 ? 0 : Math.round((controlledCount / activeCount) * 100);
    const nextAttentionItem = medicines.find((item) =>
      isNeedAttentionStatus(item.stokStatus)
    );

    return {
      activeCount,
      needsAttentionCount,
      controlledCount,
      readinessPercent,
      nextAttentionItem,
    };
  }, [medicines]);

  const heroMessage =
    medicines.length === 0
      ? noReceivedMedicinesMessage
      : summary.needsAttentionCount > 0
      ? `Ada ${summary.needsAttentionCount} obat yang perlu perhatian stok. Aktifkan pengingat agar jadwal minum tetap terjaga.`
      : nomorPeresepanQuery.trim().length > 0
        ? `Hasil pencarian untuk nomor peresepan ${nomorPeresepanQuery} siap ditinjau.`
        : "Semua obat pada daftar Anda berada dalam kondisi stok aman. Lanjutkan terapi sesuai aturan pakai.";

  const updatedLabel =
    lastUpdatedAt.length > 0
      ? new Date(lastUpdatedAt).toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "-";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">Pusat Informasi Obat</h1>
        <p className="text-muted-foreground text-sm">
          Layanan pendampingan obat pasien dengan ringkasan terapi, edukasi aman, dan aksi cepat.
        </p>
      </div>

      <Card className="relative overflow-hidden border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-white to-lime-100 dark:border-emerald-900/70 dark:from-emerald-950/30 dark:via-background dark:to-lime-950/20">
        <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-emerald-300/30 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-12 -left-10 h-32 w-32 rounded-full bg-lime-300/30 blur-2xl" />
        <CardHeader className="relative">
          <CardTitle>Pusat Informasi Obat Pasien</CardTitle>
          <CardDescription className="max-w-3xl text-foreground/70 dark:text-foreground/80">
            {heroMessage}
          </CardDescription>
        </CardHeader>
        <CardContent className="relative flex flex-wrap gap-2">
          <Button
            asChild
            className="bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:from-emerald-400 hover:to-green-500"
          >
            <Link href="/pasien/asisten-obat">Konsultasi Asisten Obat</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/pasien/pelacakan-status">Lacak Status Peracikan</Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="border-emerald-200/80 bg-emerald-50/60 dark:border-emerald-900/70 dark:bg-emerald-950/20">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Obat Aktif</p>
            <p className="mt-1 font-semibold text-2xl text-foreground">{summary.activeCount}</p>
            <p className="mt-1 text-muted-foreground text-xs">Total regimen yang dipantau hari ini</p>
          </CardContent>
        </Card>

        <Card className="border-amber-200/80 bg-amber-50/60 dark:border-amber-900/70 dark:bg-amber-950/20">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Perlu Perhatian</p>
            <p className="mt-1 font-semibold text-2xl text-foreground">{summary.needsAttentionCount}</p>
            <p className="mt-1 text-muted-foreground text-xs">Obat dengan stok terbatas atau kritis</p>
          </CardContent>
        </Card>

        <Card className="border-sky-200/80 bg-sky-50/60 dark:border-sky-900/70 dark:bg-sky-950/20">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Kesiapan Terapi</p>
            <p className="mt-1 font-semibold text-2xl text-foreground">{summary.readinessPercent}%</p>
            <p className="mt-1 text-muted-foreground text-xs">Rasio obat dengan stok aman</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Panduan Obat Personal</CardTitle>
          <CardDescription>
            Data simulasi ini meniru layanan informasi obat yang biasanya diberikan saat pendampingan pasien.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="grid gap-3 md:grid-cols-[1fr_auto_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              const normalizedInput = nomorPeresepanInput.trim().toUpperCase();
              if (!isValidPrescriptionNumber(normalizedInput)) {
                setErrorMessage(
                  "Format nomor peresepan tidak valid. Gunakan huruf/angka/strip dengan panjang 5-40 karakter.",
                );
                return;
              }

              setErrorMessage("");
              setNomorPeresepanQuery(normalizedInput);
            }}
          >
            <Input
              value={nomorPeresepanInput}
              onChange={(event) => setNomorPeresepanInput(event.target.value)}
              placeholder="Cari berdasarkan nomor peresepan, contoh RSP-2026-0001"
            />
            <Button type="submit">Cari Resep</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setNomorPeresepanInput("");
                setNomorPeresepanQuery("");
              }}
            >
              Reset
            </Button>
          </form>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {nomorPeresepanQuery.trim().length > 0 ? (
              <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
                Monitoring resep aktif: {nomorPeresepanQuery}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-border bg-muted text-foreground">
                Monitoring resep: semua data pasien
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">Terakhir sinkron: {updatedLabel}</p>
            <Button type="button" variant="outline" onClick={() => void loadMedicines()}>
              Muat Ulang
            </Button>
          </div>

          {errorMessage ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800 text-sm dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {errorMessage}
            </div>
          ) : null}

          {isLoading ? (
            <div className="rounded-md border border-border bg-muted/35 p-3 text-muted-foreground text-sm">
              Memuat daftar obat...
            </div>
          ) : medicines.length === 0 ? (
            <div className="rounded-md border border-border bg-muted/35 p-3 text-muted-foreground text-sm">
              {noReceivedMedicinesMessage}
            </div>
          ) : (
            medicines.map((item) => {
              const dispensingBadge = item.dispensingWorkflowStatus
                ? dispensingWorkflowBadge(item.dispensingWorkflowStatus)
                : null;
              const dispensingUpdatedLabel = item.dispensingUpdatedAt
                ? new Date(item.dispensingUpdatedAt).toLocaleString("id-ID")
                : "-";

              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-border/90 bg-background/90 p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-base text-foreground">{item.nama}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={stockBadgeClassName(item.stokStatus)}>
                        {item.stokStatus}
                      </Badge>
                      {dispensingBadge ? (
                        <Badge variant="outline" className={dispensingBadge.className}>
                          {dispensingBadge.text}
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  <p className="mt-1 text-muted-foreground text-sm">{item.tujuanTerapi}</p>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-md border border-border bg-muted/20 p-3">
                      <p className="font-medium text-foreground text-xs uppercase tracking-wide">
                        Aturan Pakai
                      </p>
                      <p className="mt-1 text-muted-foreground text-sm">{item.aturan}</p>
                    </div>

                    <div className="rounded-md border border-border bg-muted/20 p-3">
                      <p className="font-medium text-foreground text-xs uppercase tracking-wide">
                        Catatan Layanan
                      </p>
                      <p className="mt-1 text-muted-foreground text-sm">{item.catatan}</p>
                    </div>

                    <div className="rounded-md border border-border bg-muted/20 p-3">
                      <p className="font-medium text-foreground text-xs uppercase tracking-wide">
                        Peringatan
                      </p>
                      <p className="mt-1 text-muted-foreground text-sm">{item.peringatan}</p>
                    </div>

                    <div className="rounded-md border border-border bg-muted/20 p-3">
                      <p className="font-medium text-foreground text-xs uppercase tracking-wide">
                        Tips Penyimpanan
                      </p>
                      <p className="mt-1 text-muted-foreground text-sm">{item.tipsPenyimpanan}</p>
                    </div>
                  </div>

                  {dispensingBadge ? (
                    <div className="mt-3 rounded-md border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-900 dark:bg-sky-950/20">
                      <p className="font-medium text-foreground text-xs uppercase tracking-wide">
                        Proses Dispensing
                      </p>
                      <p className="mt-1 text-muted-foreground text-sm">
                        {item.nomorPeresepan
                          ? `Nomor peresepan ${item.nomorPeresepan}`
                          : "Nomor peresepan tidak tersedia"}
                        {item.nomorObat ? ` • Nomor obat ${item.nomorObat}` : ""}
                      </p>
                      <p className="mt-1 text-muted-foreground text-xs">
                        Update terakhir: {dispensingUpdatedLabel}
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-3">
                    <p className="font-medium text-foreground text-xs uppercase tracking-wide">
                      Waktu Minum Rekomendasi
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.waktuKonsumsi.map((slot, slotIndex) => (
                        <span
                          key={`${item.id}-${slotIndex}`}
                          className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-800 text-xs dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
                        >
                          {slot}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card className="border-emerald-200/80 bg-white/95 dark:border-emerald-900/70 dark:bg-card">
        <CardHeader>
          <CardTitle>Pendampingan Pasien Hari Ini</CardTitle>
          <CardDescription>
            Rekomendasi layanan singkat agar terapi lebih terarah dan pasien merasa didampingi.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <p className="font-medium text-sm text-foreground">Checklist Aman Minum Obat</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground text-sm">
              <li>Minum obat sesuai aturan dan jam yang sama setiap hari.</li>
              <li>Jangan menggandakan dosis saat lupa minum tanpa konfirmasi.</li>
              <li>Catat keluhan baru untuk dilaporkan saat kontrol berikutnya.</li>
            </ul>
          </div>

          <div className="rounded-md border border-border bg-muted/20 p-3">
            <p className="font-medium text-sm text-foreground">Prioritas Tindak Lanjut</p>
            <p className="mt-2 text-muted-foreground text-sm">
              {summary.nextAttentionItem
                ? `${summary.nextAttentionItem.nama} memiliki ${summary.nextAttentionItem.stokStatus.toLowerCase()}. Disarankan konfirmasi ke apotek sebelum kunjungan.`
                : "Belum ada obat dengan status kritis/terbatas. Pertahankan kepatuhan minum obat Anda."}
            </p>
            <p className="mt-2 text-muted-foreground text-sm">
              Obat dengan stok aman: {summary.controlledCount} dari {summary.activeCount} regimen.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
