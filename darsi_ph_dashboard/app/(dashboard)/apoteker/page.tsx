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
import {
  APOTEKER_OVERVIEW_AUTO_REFRESH_INTERVAL_MS,
  isApotekerAutoRefreshEnabled,
} from "@/lib/apoteker/apoteker-runtime-config";
import type { DemoDispensingOrder, DemoMedicineTransaction } from "@/lib/demo/types";

interface DispensingResponse {
  orders: DemoDispensingOrder[];
}

interface TransactionsResponse {
  transactions: DemoMedicineTransaction[];
}

const modules = [
  {
    title: "Asisten Obat",
    description: "Chatbot klinis dengan rujukan RSI, e-Fornas, dan pemetaan ICD-10.",
    href: "/apoteker/asisten-obat",
  },
  {
    title: "Dispensing",
    description: "Alur siapkan obat, update status, dan cetak label langsung di satu menu.",
    href: "/apoteker/dispensing",
  },
  {
    title: "Validasi Resep",
    description: "Pemeriksaan dosis, interaksi, alergi, kontraindikasi, dan stok obat.",
    href: "/apoteker/validasi-resep",
  },
  {
    title: "Monitoring Stok Obat",
    description: "Pantau stok kritis, batch, dan sinkronisasi data obat dengan admin.",
    href: "/apoteker/monitoring-stok",
  },
  {
    title: "Daftar Transaksi Obat",
    description: "Lacak mutasi stok real-time dengan Nomor Transaksi terstruktur.",
    href: "/apoteker/transaksi-obat",
  },
];

function resolveWorkflowStatus(order: DemoDispensingOrder): string {
  if (order.workflowStatus) {
    return order.workflowStatus;
  }

  if (order.status === "selesai") {
    return "diserahkan";
  }

  if (order.status === "siap_diserahkan") {
    return "siap_diserahkan";
  }

  if (order.status === "diracik") {
    return "sedang_diracik";
  }

  return "menunggu_pembayaran";
}

export default function ApotekerOverviewPage() {
  const [orders, setOrders] = useState<DemoDispensingOrder[]>([]);
  const [transactions, setTransactions] = useState<DemoMedicineTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");

  const loadOverviewData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const [dispensingResponse, transactionsResponse] = await Promise.all([
        fetch("/api/demo/apoteker/dispensing", { cache: "no-store" }),
        fetch("/api/demo/apoteker/transaksi-obat?limit=8", { cache: "no-store" }),
      ]);

      const dispensingPayload = (await dispensingResponse.json()) as DispensingResponse & {
        error?: string;
      };
      const transactionsPayload = (await transactionsResponse.json()) as TransactionsResponse & {
        error?: string;
      };

      if (!dispensingResponse.ok) {
        throw new Error(dispensingPayload.error || "Gagal memuat antrean dispensing.");
      }

      if (!transactionsResponse.ok) {
        throw new Error(transactionsPayload.error || "Gagal memuat aktivitas operasional.");
      }

      setOrders(dispensingPayload.orders ?? []);
      setTransactions(transactionsPayload.transactions ?? []);
      setLastUpdatedAt(new Date().toISOString());
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Terjadi kesalahan saat memuat dashboard.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverviewData();
  }, [loadOverviewData]);

  useEffect(() => {
    if (!isApotekerAutoRefreshEnabled()) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadOverviewData();
    }, APOTEKER_OVERVIEW_AUTO_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadOverviewData]);

  const summary = useMemo(() => {
    const antreanDispensing = orders.filter((order) => {
      const status = resolveWorkflowStatus(order);
      return status !== "diserahkan" && status !== "cancel";
    }).length;

    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate(),
    ).padStart(2, "0")}`;

    const resepValidatedToday = new Set(
      orders
        .filter((order) => {
          const status = resolveWorkflowStatus(order);
          const timestamp = order.updatedAt || order.createdAt;
          const date = new Date(timestamp);
          const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
            date.getDate(),
          ).padStart(2, "0")}`;

          return (
            order.nomorPeresepan &&
            status !== "menunggu_validasi_resep" &&
            status !== "cancel" &&
            dateKey === todayKey
          );
        })
        .map((order) => order.nomorPeresepan as string),
    ).size;

    return {
      antreanDispensing,
      resepValidatedToday,
      activityCount: transactions.length,
    };
  }, [orders, transactions]);

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
        <h1 className="font-semibold text-2xl text-foreground">Dashboard Apoteker</h1>
        <p className="text-muted-foreground text-sm">
          Ringkasan operasional harian apoteker dengan panduan alur kerja terstandar.
        </p>
      </div>

      <Card className="border-emerald-200/80 bg-emerald-50/40 dark:border-emerald-900/70 dark:bg-emerald-950/20">
        <CardHeader>
          <CardTitle>Panduan Singkat Penggunaan Sistem</CardTitle>
          <CardDescription>
            Ikuti urutan kerja: validasi resep, proses dispensing, monitoring stok, lalu verifikasi transaksi.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>1. Mulai dari menu Validasi Resep untuk cek keamanan klinis dan kelengkapan resep.</p>
          <p>2. Lanjutkan ke Dispensing untuk penyiapan obat, perubahan status, dan cetak label terintegrasi.</p>
          <p>3. Pantau ketersediaan pada Monitoring Stok dan pastikan sinkron dengan data admin.</p>
          <p>4. Audit mutasi melalui Daftar Transaksi Obat berdasarkan nomor transaksi.</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Antrean Dispensing Aktif</CardDescription>
            <CardTitle className="text-2xl">
              {isLoading ? "..." : summary.antreanDispensing}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Resep Tervalidasi Hari Ini</CardDescription>
            <CardTitle className="text-2xl">
              {isLoading ? "..." : summary.resepValidatedToday}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Aktivitas Operasional Terkini</CardDescription>
            <CardTitle className="text-2xl">{isLoading ? "..." : summary.activityCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {errorMessage ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-rose-900 text-sm dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">
          {errorMessage}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {modules.map((item) => (
          <Card
            key={item.title}
            className="border-emerald-200/80 bg-white/95 dark:border-emerald-900/80 dark:bg-[#0f1a15]"
          >
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

      <Card>
        <CardHeader>
          <CardTitle>Riwayat Aktivitas Real-Time</CardTitle>
          <CardDescription>
            Menampilkan log mutasi obat terbaru yang berjalan pada sistem operasional.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-xs">Terakhir sinkron: {updatedLabel}</p>
            <Button type="button" variant="outline" onClick={() => void loadOverviewData()}>
              Muat Ulang
            </Button>
          </div>

          {isLoading ? (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-muted-foreground text-sm">
              Memuat aktivitas operasional...
            </div>
          ) : transactions.length === 0 ? (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-muted-foreground text-sm">
              Belum ada aktivitas operasional terbaru.
            </div>
          ) : (
            transactions.map((item) => (
              <div key={item.id} className="rounded-md border border-border bg-muted/20 p-3 text-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="font-medium text-foreground">{item.nomorObat}</p>
                  <Badge variant="outline" className="border-border bg-muted text-foreground">
                    {new Date(item.occurredAt).toLocaleTimeString("id-ID", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs">{item.note || "Mutasi stok tercatat."}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
