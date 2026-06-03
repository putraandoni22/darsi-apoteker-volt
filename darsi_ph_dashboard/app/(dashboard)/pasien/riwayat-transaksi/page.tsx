"use client";

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
  DemoPatientPaymentSummary,
  DemoPaymentStatus,
} from "@/lib/demo/types";

interface PaymentsResponse {
  payments: DemoPatientPaymentSummary[];
  filters?: {
    nomorPeresepan?: string;
  };
}

interface MedicinesResponse {
  medicines: DemoPatientMedicineInfo[];
  filters?: {
    nomorPeresepan?: string;
  };
}

function paymentStatusBadge(status: DemoPaymentStatus): {
  text: string;
  className: string;
} {
  if (status === "lunas") {
    return {
      text: "Lunas",
      className:
        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
    };
  }

  if (status === "gagal") {
    return {
      text: "Gagal",
      className:
        "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200",
    };
  }

  if (status === "dibatalkan") {
    return {
      text: "Dibatalkan",
      className:
        "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200",
    };
  }

  if (status === "refund") {
    return {
      text: "Refund",
      className:
        "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200",
    };
  }

  return {
    text: "Menunggu Pembayaran",
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  };
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

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function isValidNomorPeresepan(value: string): boolean {
  if (!value.trim()) {
    return true;
  }

  return /^[A-Z0-9-]{5,40}$/.test(value.trim().toUpperCase());
}

function buildTransactionNumber(item: DemoPatientPaymentSummary): string {
  const timestamp = new Date(item.paidAt ?? item.updatedAt);
  const datePart = Number.isNaN(timestamp.getTime())
    ? "00000000"
    : `${timestamp.getFullYear()}${String(timestamp.getMonth() + 1).padStart(2, "0")}${String(
        timestamp.getDate(),
      ).padStart(2, "0")}`;

  const idPart = item.id.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(-6) || "000000";
  return `TRX-${datePart}-${idPart}`;
}

export default function PasienRiwayatTransaksiPage() {
  const [payments, setPayments] = useState<DemoPatientPaymentSummary[]>([]);
  const [medicines, setMedicines] = useState<DemoPatientMedicineInfo[]>([]);
  const [nomorPeresepanInput, setNomorPeresepanInput] = useState("");
  const [nomorPeresepanQuery, setNomorPeresepanQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const params = new URLSearchParams();
      if (nomorPeresepanQuery.trim()) {
        params.set("nomorPeresepan", nomorPeresepanQuery.trim().toUpperCase());
      }

      const queryString = params.toString();
      const paymentsUrl = queryString
        ? `/api/demo/pasien/pembayaran?${queryString}`
        : "/api/demo/pasien/pembayaran";
      const medicinesUrl = queryString
        ? `/api/demo/pasien/informasi-obat?${queryString}`
        : "/api/demo/pasien/informasi-obat";

      const [paymentsResponse, medicinesResponse] = await Promise.all([
        fetch(paymentsUrl, { cache: "no-store" }),
        fetch(medicinesUrl, { cache: "no-store" }),
      ]);

      const paymentsPayload = (await paymentsResponse.json()) as PaymentsResponse & {
        error?: string;
      };
      const medicinesPayload = (await medicinesResponse.json()) as MedicinesResponse & {
        error?: string;
      };

      if (!paymentsResponse.ok) {
        throw new Error(paymentsPayload.error || "Gagal mengambil riwayat transaksi resep.");
      }

      if (!medicinesResponse.ok) {
        throw new Error(medicinesPayload.error || "Gagal mengambil riwayat medikasi.");
      }

      setPayments(paymentsPayload.payments ?? []);
      setMedicines(medicinesPayload.medicines ?? []);
      setNomorPeresepanInput(paymentsPayload.filters?.nomorPeresepan ?? nomorPeresepanQuery);
      setLastUpdatedAt(new Date().toISOString());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Terjadi kesalahan.";
      setErrorMessage(message);
      setPayments([]);
      setMedicines([]);
    } finally {
      setIsLoading(false);
    }
  }, [nomorPeresepanQuery]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const summary = useMemo(() => {
    const lunasCount = payments.filter((item) => item.statusBayar === "lunas").length;
    const totalItems = payments.reduce((total, item) => total + item.items.length, 0);
    const totalTagihan = payments.reduce((total, item) => total + item.totalTagihan, 0);

    return {
      totalResep: payments.length,
      lunasCount,
      totalItems,
      totalTagihan,
      totalMedikasi: medicines.length,
    };
  }, [payments, medicines]);

  const sortedPayments = useMemo(
    () => [...payments].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [payments],
  );

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
        <h1 className="font-semibold text-2xl text-foreground">Riwayat Transaksi & Medikasi</h1>
        <p className="text-muted-foreground text-sm">
          Rekap pembayaran resep dan histori medikasi pasien untuk tindak lanjut terapi.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Total Resep</p>
            <p className="mt-1 font-semibold text-2xl text-foreground">{summary.totalResep}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Resep Lunas</p>
            <p className="mt-1 font-semibold text-2xl text-foreground">{summary.lunasCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Item Obat</p>
            <p className="mt-1 font-semibold text-2xl text-foreground">{summary.totalItems}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Total Tagihan</p>
            <p className="mt-1 font-semibold text-lg text-foreground">{formatCurrency(summary.totalTagihan)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Medikasi Tercatat</p>
            <p className="mt-1 font-semibold text-2xl text-foreground">{summary.totalMedikasi}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter Riwayat</CardTitle>
          <CardDescription>
            Gunakan nomor peresepan untuk meninjau histori transaksi dan medikasi spesifik.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="grid gap-3 md:grid-cols-[1fr_auto_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              const normalized = nomorPeresepanInput.trim().toUpperCase();

              if (!isValidNomorPeresepan(normalized)) {
                setErrorMessage(
                  "Format nomor peresepan tidak valid. Gunakan huruf/angka/strip dengan panjang 5-40 karakter.",
                );
                return;
              }

              setErrorMessage("");
              setNomorPeresepanQuery(normalized);
            }}
          >
            <Input
              value={nomorPeresepanInput}
              onChange={(event) => setNomorPeresepanInput(event.target.value)}
              placeholder="Contoh: RSP-2026-0001"
              maxLength={40}
            />
            <Button type="submit">Cari</Button>
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

          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">Terakhir sinkron: {updatedLabel}</p>
            <Button type="button" variant="outline" onClick={() => void loadHistory()}>
              Muat Ulang
            </Button>
          </div>

          {errorMessage ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800 text-sm dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {errorMessage}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat Transaksi Resep</CardTitle>
          <CardDescription>
            Berisi status pembayaran, detail tagihan, dan progres dispensing setiap resep.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="rounded-md border border-border bg-muted/35 p-3 text-muted-foreground text-sm">
              Memuat riwayat transaksi...
            </div>
          ) : sortedPayments.length === 0 ? (
            <div className="rounded-md border border-border bg-muted/35 p-3 text-muted-foreground text-sm">
              {nomorPeresepanQuery
                ? `Riwayat transaksi untuk resep ${nomorPeresepanQuery} tidak ditemukan.`
                : "Belum ada riwayat transaksi resep."}
            </div>
          ) : (
            sortedPayments.map((item) => {
              const paymentBadge = paymentStatusBadge(item.statusBayar);

              return (
                <div key={item.id} className="rounded-xl border border-border/90 bg-background/90 p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-base text-foreground">
                        Resep {item.nomorPeresepan}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {item.patientName} • {item.nomorRM}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        Update {new Date(item.updatedAt).toLocaleString("id-ID")}
                      </p>
                    </div>
                    <Badge variant="outline" className={paymentBadge.className}>
                      {paymentBadge.text}
                    </Badge>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-4">
                    <div className="rounded-md border border-border bg-muted/20 p-3">
                      <p className="text-muted-foreground text-xs">Nomor Transaksi</p>
                      <p className="font-mono text-xs text-foreground">
                        {buildTransactionNumber(item)}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-muted/20 p-3">
                      <p className="text-muted-foreground text-xs">Total Tagihan</p>
                      <p className="font-medium text-sm text-foreground">
                        {formatCurrency(item.totalTagihan)}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-muted/20 p-3">
                      <p className="text-muted-foreground text-xs">Total Dibayar</p>
                      <p className="font-medium text-sm text-foreground">
                        {formatCurrency(item.totalDibayar)}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-muted/20 p-3">
                      <p className="text-muted-foreground text-xs">Sisa Tagihan</p>
                      <p className="font-medium text-sm text-foreground">
                        {formatCurrency(item.sisaTagihan)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 space-y-2">
                    {item.dispensing.length === 0 ? (
                      <p className="text-muted-foreground text-sm">Belum ada data dispensing terkait resep ini.</p>
                    ) : (
                      item.dispensing.map((dispensing) => {
                        const badge = dispensingWorkflowBadge(dispensing.workflowStatus);
                        return (
                          <div
                            key={dispensing.orderId}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-3 py-2"
                          >
                            <p className="text-foreground text-sm">
                              {dispensing.medicineName} • {dispensing.dosage} • Qty {dispensing.quantity}
                            </p>
                            <Badge variant="outline" className={badge.className}>
                              {badge.text}
                            </Badge>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat Medikasi</CardTitle>
          <CardDescription>
            Menampilkan daftar obat beserta aturan pakai dan catatan pelayanan pasien.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <div className="rounded-md border border-border bg-muted/35 p-3 text-muted-foreground text-sm">
              Memuat riwayat medikasi...
            </div>
          ) : medicines.length === 0 ? (
            <div className="rounded-md border border-border bg-muted/35 p-3 text-muted-foreground text-sm">
              Belum ada riwayat medikasi.
            </div>
          ) : (
            medicines.map((medicine) => (
              <div key={medicine.id} className="rounded-md border border-border bg-muted/20 p-3">
                <p className="font-medium text-foreground text-sm">{medicine.nama}</p>
                <p className="text-muted-foreground text-xs">Aturan: {medicine.aturan}</p>
                <p className="text-muted-foreground text-xs">Catatan: {medicine.catatan}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
