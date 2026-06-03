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
  DemoPatientPaymentSummary,
} from "@/lib/demo/types";

interface PaymentsResponse {
  payments: DemoPatientPaymentSummary[];
  filters?: {
    nomorPeresepan?: string;
  };
}

function workflowBadge(status: DemoDispensingWorkflowStatus): {
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

function parseWorkflowStep(status: DemoDispensingWorkflowStatus): number {
  if (status === "menunggu_validasi_resep") {
    return 1;
  }
  if (status === "menunggu_pembayaran") {
    return 2;
  }
  if (status === "siap_diracik") {
    return 3;
  }
  if (status === "sedang_diracik") {
    return 4;
  }
  if (status === "siap_diserahkan") {
    return 5;
  }
  if (status === "diserahkan") {
    return 6;
  }

  return 0;
}

function isValidNomorPeresepan(value: string): boolean {
  if (!value.trim()) {
    return true;
  }

  return /^[A-Z0-9-]{5,40}$/.test(value.trim().toUpperCase());
}

export default function PasienPelacakanStatusPage() {
  const [payments, setPayments] = useState<DemoPatientPaymentSummary[]>([]);
  const [nomorPeresepanInput, setNomorPeresepanInput] = useState("");
  const [nomorPeresepanQuery, setNomorPeresepanQuery] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadTracking = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const params = new URLSearchParams();
      if (nomorPeresepanQuery.trim()) {
        params.set("nomorPeresepan", nomorPeresepanQuery.trim().toUpperCase());
      }

      const queryString = params.toString();
      const url = queryString
        ? `/api/demo/pasien/pembayaran?${queryString}`
        : "/api/demo/pasien/pembayaran";

      const response = await fetch(url, { cache: "no-store" });
      const payload = (await response.json()) as PaymentsResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Gagal mengambil data pelacakan peracikan.");
      }

      setPayments(payload.payments ?? []);
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
    void loadTracking();
  }, [loadTracking]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadTracking();
    }, 20_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadTracking]);

  const summary = useMemo(() => {
    const allDispensing = payments.flatMap((item) => item.dispensing);

    return {
      totalResep: payments.length,
      sedangDiracik: allDispensing.filter((item) => item.workflowStatus === "sedang_diracik").length,
      siapDiserahkan: allDispensing.filter((item) => item.workflowStatus === "siap_diserahkan").length,
      sudahDiserahkan: allDispensing.filter((item) => item.workflowStatus === "diserahkan").length,
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
        <h1 className="font-semibold text-2xl text-foreground">Pelacakan Status Peracikan</h1>
        <p className="text-muted-foreground text-sm">
          Pantau perkembangan resep Anda secara real-time dari validasi hingga obat diserahkan.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Resep Aktif</p>
            <p className="mt-1 font-semibold text-2xl text-foreground">{summary.totalResep}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Sedang Diracik</p>
            <p className="mt-1 font-semibold text-2xl text-foreground">{summary.sedangDiracik}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Siap Diserahkan</p>
            <p className="mt-1 font-semibold text-2xl text-foreground">{summary.siapDiserahkan}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs">Sudah Diserahkan</p>
            <p className="mt-1 font-semibold text-2xl text-foreground">{summary.sudahDiserahkan}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Pelacakan Resep</CardTitle>
          <CardDescription>
            Cari berdasarkan nomor peresepan untuk melihat detail progres tiap item obat.
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
            <Button type="button" variant="outline" onClick={() => void loadTracking()}>
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
              Memuat progres peracikan...
            </div>
          ) : payments.length === 0 ? (
            <div className="rounded-md border border-border bg-muted/35 p-3 text-muted-foreground text-sm">
              {nomorPeresepanQuery
                ? `Data untuk nomor peresepan ${nomorPeresepanQuery} tidak ditemukan.`
                : "Belum ada data peracikan yang bisa ditampilkan."}
            </div>
          ) : (
            payments.map((payment) => {
              const highestStep =
                payment.dispensing.length > 0
                  ? Math.max(...payment.dispensing.map((item) => parseWorkflowStep(item.workflowStatus)))
                  : 0;
              const progressPercent = Math.round((highestStep / 6) * 100);

              return (
                <div key={payment.id} className="rounded-xl border border-border/90 bg-background/90 p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-base text-foreground">
                        Resep {payment.nomorPeresepan}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {payment.patientName} • {payment.nomorRM}
                      </p>
                    </div>
                    <Badge variant="outline" className="border-border bg-muted text-foreground">
                      Progres {progressPercent}%
                    </Badge>
                  </div>

                  {payment.dispensing.length === 0 ? (
                    <div className="mt-3 rounded-md border border-border bg-muted/20 p-3 text-muted-foreground text-sm">
                      Belum ada order peracikan untuk resep ini.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {payment.dispensing.map((item) => {
                        const badge = workflowBadge(item.workflowStatus);
                        return (
                          <div
                            key={item.orderId}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-3 py-2"
                          >
                            <div>
                              <p className="text-foreground text-sm">
                                {item.medicineName} • {item.dosage} • Qty {item.quantity}
                              </p>
                              <p className="text-muted-foreground text-xs">
                                {item.nomorObat
                                  ? `Nomor obat ${item.nomorObat}`
                                  : "Nomor obat belum tersedia"}
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
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
