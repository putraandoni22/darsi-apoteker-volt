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
  DemoPatientDispensingProgress,
  DemoPatientPaymentSummary,
  DemoPaymentMethod,
  DemoPaymentStatus,
} from "@/lib/demo/types";

interface PaymentMethodOption {
  value: DemoPaymentMethod;
  label: string;
}

interface PaymentsResponse {
  payments: DemoPatientPaymentSummary[];
  filters?: {
    nomorPeresepan?: string;
  };
  methods?: PaymentMethodOption[];
}

interface ConfirmPaymentResponse {
  payment: DemoPatientPaymentSummary;
  updated: boolean;
  relatedOrderCount: number;
  dispensing: DemoPatientDispensingProgress[];
}

function isValidNomorPeresepan(value: string): boolean {
  if (!value.trim()) {
    return true;
  }

  return /^[A-Z0-9-]{5,40}$/.test(value.trim().toUpperCase());
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

const FALLBACK_METHODS: PaymentMethodOption[] = [
  { value: "cash", label: "Tunai" },
  { value: "debit", label: "Debit" },
  { value: "credit", label: "Kartu Kredit" },
  { value: "bpjs", label: "BPJS" },
  { value: "lainnya", label: "Lainnya" },
];

export default function PasienPembayaranPage() {
  const [payments, setPayments] = useState<DemoPatientPaymentSummary[]>([]);
  const [methods, setMethods] = useState<PaymentMethodOption[]>(FALLBACK_METHODS);
  const [selectedMethod, setSelectedMethod] = useState<DemoPaymentMethod>("debit");
  const [nomorPeresepanInput, setNomorPeresepanInput] = useState("");
  const [nomorPeresepanQuery, setNomorPeresepanQuery] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [processingNomorPeresepan, setProcessingNomorPeresepan] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastConfirmedDispensing, setLastConfirmedDispensing] = useState<{
    nomorPeresepan: string;
    paidAt?: string;
    relatedOrderCount: number;
    dispensing: DemoPatientDispensingProgress[];
  } | null>(null);

  const loadPayments = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const params = new URLSearchParams();
      if (nomorPeresepanQuery.trim()) {
        params.set("nomorPeresepan", nomorPeresepanQuery.trim().toUpperCase());
      }

      const queryString = params.toString();
      const targetUrl = queryString
        ? `/api/demo/pasien/pembayaran?${queryString}`
        : "/api/demo/pasien/pembayaran";

      const response = await fetch(targetUrl, { cache: "no-store" });
      const payload = (await response.json()) as PaymentsResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Gagal mengambil data pembayaran.");
      }

      setPayments(payload.payments);
      setMethods(payload.methods && payload.methods.length > 0 ? payload.methods : FALLBACK_METHODS);
      setSelectedMethod((current) => {
        const hasCurrent = (payload.methods ?? FALLBACK_METHODS).some(
          (method) => method.value === current,
        );
        return hasCurrent ? current : "debit";
      });
      setNomorPeresepanInput(payload.filters?.nomorPeresepan ?? nomorPeresepanQuery);
      setLastUpdatedAt(new Date().toISOString());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Terjadi kesalahan.";
      setErrorMessage(message);
      setPayments([]);
    } finally {
      setIsLoading(false);
    }
  }, [nomorPeresepanQuery]);

  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);

  async function handleConfirmPayment(nomorPeresepan: string) {
    setIsSubmitting(true);
    setProcessingNomorPeresepan(nomorPeresepan);
    setErrorMessage("");

    try {
      const response = await fetch("/api/demo/pasien/pembayaran", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nomorPeresepan,
          metodeBayar: selectedMethod,
        }),
      });

      const payload = (await response.json()) as ConfirmPaymentResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Konfirmasi pembayaran gagal.");
      }

      setLastConfirmedDispensing({
        nomorPeresepan,
        paidAt: payload.payment.paidAt,
        relatedOrderCount: payload.relatedOrderCount,
        dispensing: payload.dispensing,
      });

      await loadPayments();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Terjadi kesalahan.";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
      setProcessingNomorPeresepan(null);
    }
  }

  const summary = useMemo(() => {
    const lunasCount = payments.filter((item) => item.statusBayar === "lunas").length;
    const pendingCount = payments.filter((item) => item.statusBayar !== "lunas").length;
    const outstandingTotal = payments.reduce(
      (accumulator, item) => accumulator + Math.max(0, item.sisaTagihan),
      0,
    );

    return {
      totalCount: payments.length,
      lunasCount,
      pendingCount,
      outstandingTotal,
    };
  }, [payments]);

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
        <h1 className="font-semibold text-2xl text-foreground">Pembayaran & Konfirmasi Resep</h1>
        <p className="text-muted-foreground text-sm">
          Konfirmasi pembayaran resep agar status dispensing di apotek otomatis bergerak dan bisa dilacak.
        </p>
      </div>

      <Card className="border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-white to-lime-100 dark:border-emerald-900/70 dark:from-emerald-950/30 dark:via-background dark:to-lime-950/20">
        <CardHeader>
          <CardTitle>Status Pembayaran Dan Konfirmasi Resep</CardTitle>
          <CardDescription>
            Setelah konfirmasi berhasil, status dispensing akan ikut bergerak dan bisa Anda pantau langsung per obat.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/pasien/informasi-obat">Lihat Informasi Obat</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/pasien/asisten-obat">Tanya Asisten Obat</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/pasien/pelacakan-status">Lacak Peracikan</Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="border-amber-200/80 bg-amber-50/60 dark:border-amber-900/70 dark:bg-amber-950/20">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Menunggu Pembayaran</p>
            <p className="mt-1 font-semibold text-2xl text-foreground">{summary.pendingCount}</p>
          </CardContent>
        </Card>

        <Card className="border-emerald-200/80 bg-emerald-50/60 dark:border-emerald-900/70 dark:bg-emerald-950/20">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Sudah Lunas</p>
            <p className="mt-1 font-semibold text-2xl text-foreground">{summary.lunasCount}</p>
          </CardContent>
        </Card>

        <Card className="border-sky-200/80 bg-sky-50/60 dark:border-sky-900/70 dark:bg-sky-950/20">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Sisa Tagihan</p>
            <p className="mt-1 font-semibold text-2xl text-foreground">
              {formatCurrency(summary.outstandingTotal)}
            </p>
          </CardContent>
        </Card>
      </div>

      {lastConfirmedDispensing ? (
        <Card className="border-sky-200/80 bg-sky-50/60 dark:border-sky-900/70 dark:bg-sky-950/20">
          <CardHeader>
            <CardTitle>Update Proses Dispensing Terakhir</CardTitle>
            <CardDescription>
              Konfirmasi pembayaran resep {lastConfirmedDispensing.nomorPeresepan} berhasil diproses pada{" "}
              {lastConfirmedDispensing.paidAt
                ? new Date(lastConfirmedDispensing.paidAt).toLocaleString("id-ID")
                : "waktu terbaru"}
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Order dispensing terhubung: {lastConfirmedDispensing.relatedOrderCount}
            </p>
            {lastConfirmedDispensing.dispensing.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Belum ada order dispensing yang terhubung ke resep ini.
              </p>
            ) : (
              <div className="space-y-2">
                {lastConfirmedDispensing.dispensing.map((item) => {
                  const badge = dispensingWorkflowBadge(item.workflowStatus);

                  return (
                    <div
                      key={item.orderId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background/80 px-3 py-2"
                    >
                      <div>
                        <p className="font-medium text-foreground text-sm">
                          {item.medicineName} • {item.dosage} • Qty {item.quantity}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {item.nomorObat ? `Nomor obat ${item.nomorObat}` : "Nomor obat belum tersedia"}
                        </p>
                      </div>
                      <Badge variant="outline" className={badge.className}>
                        {badge.text}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Daftar Tagihan Resep</CardTitle>
          <CardDescription>
            Cari berdasarkan nomor peresepan untuk mempercepat konfirmasi pembayaran.
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

          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <span>Terakhir sinkron: {updatedLabel}</span>
              <span>•</span>
              <span>Total resep: {summary.totalCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">Metode bayar</span>
              <select
                className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                value={selectedMethod}
                onChange={(event) => setSelectedMethod(event.target.value as DemoPaymentMethod)}
              >
                {methods.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => void loadPayments()}>
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
              Memuat data pembayaran...
            </div>
          ) : payments.length === 0 ? (
            <div className="rounded-md border border-border bg-muted/35 p-3 text-muted-foreground text-sm">
              {nomorPeresepanQuery
                ? `Tidak ada data tagihan untuk nomor peresepan ${nomorPeresepanQuery}.`
                : "Belum ada tagihan resep untuk akun pasien ini."}
            </div>
          ) : (
            payments.map((payment) => {
              const badge = paymentStatusBadge(payment.statusBayar);
              const isPaid = payment.statusBayar === "lunas";
              const isProcessing =
                isSubmitting && processingNomorPeresepan === payment.nomorPeresepan;

              return (
                <div
                  key={payment.id}
                  className="rounded-xl border border-border/90 bg-background/90 p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-base text-foreground">
                        Resep {payment.nomorPeresepan}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {payment.patientName} • {payment.nomorRM}
                      </p>
                      <p className="text-muted-foreground text-xs">Dokter: {payment.doctorName}</p>
                    </div>
                    <Badge className={badge.className}>{badge.text}</Badge>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <div className="rounded-md border border-border bg-muted/20 p-3">
                      <p className="text-muted-foreground text-xs">Total Tagihan</p>
                      <p className="font-medium text-sm text-foreground">
                        {formatCurrency(payment.totalTagihan)}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-muted/20 p-3">
                      <p className="text-muted-foreground text-xs">Total Dibayar</p>
                      <p className="font-medium text-sm text-foreground">
                        {formatCurrency(payment.totalDibayar)}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-muted/20 p-3">
                      <p className="text-muted-foreground text-xs">Sisa</p>
                      <p className="font-medium text-sm text-foreground">
                        {formatCurrency(payment.sisaTagihan)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <p className="font-medium text-foreground text-xs uppercase tracking-wide">
                      Daftar Obat Resep
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground text-sm">
                      {payment.items.map((item) => (
                        <li key={item.id}>
                          {item.medicineName} • {item.dosis} • Qty {item.qty}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-3">
                    <p className="font-medium text-foreground text-xs uppercase tracking-wide">
                      Status Proses Dispensing
                    </p>
                    {payment.dispensing.length === 0 ? (
                      <p className="mt-2 text-muted-foreground text-sm">
                        Belum ada order dispensing untuk resep ini.
                      </p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {payment.dispensing.map((dispensingItem) => {
                          const workflowBadge = dispensingWorkflowBadge(
                            dispensingItem.workflowStatus,
                          );

                          return (
                            <div
                              key={dispensingItem.orderId}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-3 py-2"
                            >
                              <div>
                                <p className="text-foreground text-sm">
                                  {dispensingItem.medicineName} • {dispensingItem.dosage} • Qty{" "}
                                  {dispensingItem.quantity}
                                </p>
                                <p className="text-muted-foreground text-xs">
                                  {dispensingItem.nomorObat
                                    ? `Nomor obat ${dispensingItem.nomorObat}`
                                    : "Nomor obat belum tersedia"}
                                </p>
                              </div>
                              <Badge variant="outline" className={workflowBadge.className}>
                                {workflowBadge.text}
                              </Badge>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-muted-foreground text-xs">
                      {isPaid
                        ? `Lunas pada ${payment.paidAt ? new Date(payment.paidAt).toLocaleString("id-ID") : "-"}`
                        : "Silakan konfirmasi setelah pembayaran dilakukan."}
                    </p>
                    {isPaid ? (
                      <Button type="button" variant="outline" disabled>
                        Sudah Lunas
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => void handleConfirmPayment(payment.nomorPeresepan)}
                      >
                        {isProcessing ? "Memproses..." : "Konfirmasi Pembayaran"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
