"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface SystemControlState {
  maintenanceMode: boolean;
  lastBackupAt: string | null;
  lastRestoreAt: string | null;
  lastRestartAt: string | null;
}

interface BackupSummary {
  backupId: string;
  fileName: string;
  createdAt: string;
  sizeBytes: number;
}

interface SystemControlApiPayload {
  system?: SystemControlState;
  backups?: BackupSummary[];
  message?: string;
  error?: string;
}

type SystemControlAction =
  | "backup-now"
  | "restore-backup"
  | "toggle-maintenance"
  | "restart-local-service";

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

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function AdminSystemControlPanel() {
  const [system, setSystem] = useState<SystemControlState | null>(null);
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [selectedBackupId, setSelectedBackupId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<SystemControlAction | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );

  const loadSystemControl = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch("/api/admin/system-control", {
        cache: "no-store",
      });

      const payload = (await response.json()) as SystemControlApiPayload;
      if (!response.ok) {
        throw new Error(payload.error || "Gagal memuat system control.");
      }

      const nextBackups = payload.backups ?? [];
      setSystem(payload.system ?? null);
      setBackups(nextBackups);
      setSelectedBackupId((previousId) => {
        const stillExists = nextBackups.some((item) => item.backupId === previousId);
        if (stillExists) {
          return previousId;
        }

        return nextBackups[0]?.backupId ?? "";
      });
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "Gagal memuat system control.",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSystemControl();
  }, [loadSystemControl]);

  const runAction = useCallback(
    async (action: SystemControlAction, extraBody?: Record<string, unknown>) => {
      setRunningAction(action);
      setFeedback(null);

      try {
        const response = await fetch("/api/admin/system-control", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action, ...(extraBody ?? {}) }),
        });

        const payload = (await response.json()) as SystemControlApiPayload;
        if (!response.ok) {
          throw new Error(payload.error || "Operasi system control gagal diproses.");
        }

        setSystem(payload.system ?? null);
        setBackups(payload.backups ?? []);
        setFeedback({
          type: "success",
          text: payload.message || "Operasi system control berhasil.",
        });
      } catch (error) {
        setFeedback({
          type: "error",
          text: error instanceof Error ? error.message : "Operasi system control gagal.",
        });
      } finally {
        setRunningAction(null);
      }
    },
    [],
  );

  const selectedBackup = useMemo(
    () => backups.find((item) => item.backupId === selectedBackupId) ?? null,
    [backups, selectedBackupId],
  );

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Manajemen Pencadangan</CardTitle>
            <CardDescription>
              Backup dan restore database utama termasuk data vector indeks.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Backup terakhir: {formatTimestamp(system?.lastBackupAt ?? null)}.</p>
            <p>Restore terakhir: {formatTimestamp(system?.lastRestoreAt ?? null)}.</p>

            <div className="rounded-md border border-border bg-muted/20 p-2">
              <p className="text-muted-foreground text-xs">Pilih snapshot backup</p>
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={selectedBackupId}
                onChange={(event) => setSelectedBackupId(event.target.value)}
                disabled={isLoading || backups.length === 0}
              >
                {backups.length === 0 ? (
                  <option value="">Belum ada backup</option>
                ) : (
                  backups.map((item) => (
                    <option key={item.backupId} value={item.backupId}>
                      {item.fileName} ({formatTimestamp(item.createdAt)})
                    </option>
                  ))
                )}
              </select>
              {selectedBackup ? (
                <p className="text-muted-foreground mt-1 text-xs">
                  Ukuran file {formatBytes(selectedBackup.sizeBytes)}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                className="bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:from-emerald-400 hover:to-green-500"
                disabled={runningAction !== null}
                onClick={() => void runAction("backup-now")}
              >
                Backup Sekarang
              </Button>
              <Button
                variant="outline"
                disabled={runningAction !== null || !selectedBackupId}
                onClick={() =>
                  void runAction("restore-backup", {
                    backupId: selectedBackupId,
                  })
                }
              >
                Restore Snapshot
              </Button>
              <Button
                variant="outline"
                disabled={!selectedBackupId}
                onClick={() => {
                  const query = encodeURIComponent(selectedBackupId);
                  window.open(`/api/admin/system-control?downloadId=${query}`, "_blank");
                }}
              >
                Unduh Backup
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Kontrol Operasional</CardTitle>
            <CardDescription>
              Pengaturan safety untuk menjaga stabilitas sistem saat jam sibuk.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Mode maintenance: {system?.maintenanceMode ? "aktif" : "nonaktif"}.</p>
            <p>Restart service terakhir: {formatTimestamp(system?.lastRestartAt ?? null)}.</p>
            <p>Status health check: sehat.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={runningAction !== null}
                onClick={() =>
                  void runAction("toggle-maintenance", {
                    enabled: !system?.maintenanceMode,
                  })
                }
              >
                {system?.maintenanceMode ? "Nonaktifkan Maintenance" : "Aktifkan Maintenance"}
              </Button>
              <Button
                variant="outline"
                disabled={runningAction !== null}
                onClick={() => void runAction("restart-local-service")}
              >
                Restart Service Lokal
              </Button>
            </div>
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
    </>
  );
}
