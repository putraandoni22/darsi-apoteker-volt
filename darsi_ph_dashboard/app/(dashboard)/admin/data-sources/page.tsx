"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const dataSources = [
  {
    name: "Database Obat Kronis RSI",
    status: "active",
    notes: "Sumber utama internal rumah sakit untuk katalog farmasi kronis.",
    owner: "Farmasi RSI",
    refresh: "Setiap 15 menit",
  },
  {
    name: "Database e-Fornas",
    status: "active",
    notes: "Sumber formularium nasional untuk pembanding referensi obat.",
    owner: "Kemenkes",
    refresh: "Harian",
  },
  {
    name: "Transaksi Apoteker & Pasien",
    status: "dummy",
    notes: "Stream transaksi dari workflow dispensing, pembayaran, dan mutasi stok.",
    owner: "Sistem DARSI",
    refresh: "Real-time",
  },
  {
    name: "Asuransi BPJS/Swasta",
    status: "dummy",
    notes: "Simulasi coverage untuk kebutuhan demo.",
    owner: "Unit Klaim",
    refresh: "On-demand",
  },
  {
    name: "Knowledge Base Dokumen AI",
    status: "active",
    notes: "Dokumen pedoman, SOP, dan referensi internal untuk indeks vektor LLM.",
    owner: "Admin DARSI",
    refresh: "Manual / terjadwal",
  },
];

function statusLabel(status: string): { text: string; className: string } {
  if (status === "active") {
    return {
      text: "Aktif",
      className:
        "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
    };
  }

  return {
    text: "Dummy",
    className:
      "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  };
}

interface AdminOperationsStatus {
  dataSource: {
    lastSyncAt: string | null;
    lastSchemaValidationAt: string | null;
    lastStatusRefreshAt: string | null;
    note: string | null;
  };
  vector: {
    scheduleEnabled: boolean;
    scheduleTime: string;
    lastIndexedAt: string | null;
    lastIndexedCount: number;
    pendingCount: number;
  };
  system: {
    maintenanceMode: boolean;
    lastBackupAt: string | null;
    lastRestoreAt: string | null;
    lastRestartAt: string | null;
  };
}

interface OperationsApiPayload {
  status?: AdminOperationsStatus;
  message?: string;
  error?: string;
}

type OperationsAction =
  | "sync-all-data"
  | "validate-schema"
  | "refresh-status"
  | "reindex-vectors"
  | "schedule-vector-sync"
  | "disable-vector-sync";

function formatTimestamp(iso: string | null): string {
  if (!iso) {
    return "Belum pernah";
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function AdminDataSourcesPage() {
  const [opsStatus, setOpsStatus] = useState<AdminOperationsStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [runningAction, setRunningAction] = useState<OperationsAction | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );

  const fetchStatus = useCallback(async () => {
    setIsLoadingStatus(true);

    try {
      const response = await fetch("/api/admin/operations", {
        cache: "no-store",
      });

      const payload = (await response.json()) as OperationsApiPayload;
      if (!response.ok) {
        throw new Error(payload.error || "Gagal memuat status operasi admin.");
      }

      if (payload.status) {
        setOpsStatus(payload.status);
      }
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "Gagal memuat status operasi admin.",
      });
    } finally {
      setIsLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const runOperation = useCallback(
    async (action: OperationsAction) => {
      setRunningAction(action);
      setFeedback(null);

      try {
        const response = await fetch("/api/admin/operations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action }),
        });

        const payload = (await response.json()) as OperationsApiPayload;
        if (!response.ok) {
          throw new Error(payload.error || "Operasi admin gagal diproses.");
        }

        if (payload.status) {
          setOpsStatus(payload.status);
        }

        setFeedback({
          type: "success",
          text: payload.message || "Operasi admin berhasil dijalankan.",
        });
      } catch (error) {
        setFeedback({
          type: "error",
          text: error instanceof Error ? error.message : "Operasi admin gagal diproses.",
        });
      } finally {
        setRunningAction(null);
      }
    },
    [],
  );

  const syncLabel = isLoadingStatus
    ? "Memuat status sinkronisasi..."
    : `Sinkronisasi terakhir: ${formatTimestamp(opsStatus?.dataSource.lastSyncAt ?? null)}`;

  const vectorStatusLabel = isLoadingStatus
    ? "Memuat status vektor..."
    : `Status indeks vektor: pending ${opsStatus?.vector.pendingCount ?? 0} dokumen. Terakhir re-index ${formatTimestamp(
        opsStatus?.vector.lastIndexedAt ?? null,
      )}.`;

  const vectorScheduleLabel = opsStatus?.vector.scheduleEnabled
    ? `Jadwal aktif ${opsStatus.vector.scheduleTime} WIB`
    : "Jadwal otomatis nonaktif";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">Data Source</h1>
        <p className="text-muted-foreground text-sm">
          Daftar sumber data yang dipakai sistem admin, apoteker, pasien, dan AI engine DARSI.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ketersediaan Integrasi Data</CardTitle>
          <CardDescription>
            Status aktif menandakan data sudah terkoneksi. Status dummy digunakan untuk mode demo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {dataSources.map((item) => {
            const status = statusLabel(item.status);
            return (
              <div
                key={item.name}
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="space-y-1">
                  <p className="font-medium text-foreground text-sm">{item.name}</p>
                  <p className="text-muted-foreground text-xs">{item.notes}</p>
                  <p className="text-muted-foreground text-xs">
                    Owner {item.owner} • Sinkronisasi {item.refresh}
                  </p>
                </div>
                <Badge className={status.className}>{status.text}</Badge>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Operasi Data Source</CardTitle>
            <CardDescription>
              Jalankan sinkronisasi dan validasi kualitas data lintas modul.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
              {syncLabel}
            </div>
            {opsStatus?.dataSource.note ? (
              <p className="text-muted-foreground text-xs">{opsStatus.dataSource.note}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                className="bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:from-emerald-400 hover:to-green-500"
                disabled={runningAction !== null}
                onClick={() => void runOperation("sync-all-data")}
              >
                Sinkronisasi Semua Data
              </Button>
              <Button
                variant="outline"
                disabled={runningAction !== null}
                onClick={() => void runOperation("validate-schema")}
              >
                Validasi Skema
              </Button>
              <Button
                variant="outline"
                disabled={runningAction !== null}
                onClick={() => void runOperation("refresh-status")}
              >
                Refresh Status
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Validasi terakhir: {formatTimestamp(opsStatus?.dataSource.lastSchemaValidationAt ?? null)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sinkronisasi Vector Database</CardTitle>
            <CardDescription>
              Re-index dokumen AI saat ada update data source atau pedoman medis baru.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="rounded-lg border border-emerald-200/70 bg-emerald-50/70 px-3 py-2 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100">
              {vectorStatusLabel}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                className="bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:from-emerald-400 hover:to-green-500"
                disabled={runningAction !== null}
                onClick={() => void runOperation("reindex-vectors")}
              >
                Re-index Sekarang
              </Button>
              <Button
                variant="outline"
                disabled={runningAction !== null}
                onClick={() =>
                  void runOperation(
                    opsStatus?.vector.scheduleEnabled
                      ? "disable-vector-sync"
                      : "schedule-vector-sync",
                  )
                }
              >
                {opsStatus?.vector.scheduleEnabled ? "Nonaktifkan Jadwal" : "Jadwalkan Harian"}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">{vectorScheduleLabel}</p>
          </CardContent>
        </Card>
      </div>

      {feedback ? (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
              : "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100"
          }`}
        >
          {feedback.text}
        </div>
      ) : null}
    </div>
  );
}
