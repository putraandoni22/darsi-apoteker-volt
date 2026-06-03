"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
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
import type { ActivityLevel, ActivityLogEntry } from "@/lib/activity/types";

type LevelFilter = ActivityLevel | "ALL";

const LEVEL_OPTIONS: Array<{ value: LevelFilter; label: string }> = [
  { value: "ALL", label: "Semua Level" },
  { value: "INFO", label: "INFO" },
  { value: "WARN", label: "WARN" },
  { value: "ERROR", label: "ERROR" },
];

const LEVEL_BADGE_CLASSNAME: Record<ActivityLevel, string> = {
  INFO:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  WARN:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  ERROR:
    "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200",
};

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function toSafeLogList(payload: unknown): ActivityLogEntry[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const logs = (payload as { logs?: unknown }).logs;
  return Array.isArray(logs) ? (logs as ActivityLogEntry[]) : [];
}

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("ALL");

  const loadLogs = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const params = new URLSearchParams({
        limit: "200",
      });

      if (levelFilter !== "ALL") {
        params.set("level", levelFilter);
      }

      if (searchQuery.trim()) {
        params.set("search", searchQuery.trim());
      }

      const response = await fetch(`/api/admin/activity-logs?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as unknown;

      if (!response.ok) {
        const typedPayload = payload as { error?: unknown };
        throw new Error(
          typeof typedPayload.error === "string"
            ? typedPayload.error
            : "Gagal memuat activity log.",
        );
      }

      setLogs(toSafeLogList(payload));
      setLastUpdatedAt(new Date().toISOString());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Gagal memuat data log.");
    } finally {
      setIsLoading(false);
    }
  }, [levelFilter, searchQuery]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const summary = useMemo(() => {
    return logs.reduce(
      (accumulator, item) => {
        if (item.level === "WARN") {
          accumulator.warn += 1;
        } else if (item.level === "ERROR") {
          accumulator.error += 1;
        } else {
          accumulator.info += 1;
        }

        return accumulator;
      },
      { info: 0, warn: 0, error: 0 },
    );
  }, [logs]);

  const latestErrors = useMemo(() => {
    return logs.filter((item) => item.level === "ERROR").slice(0, 5);
  }, [logs]);

  function onFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchQuery(searchInput.trim());
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">Log Aktivitas & Error</h1>
        <p className="text-muted-foreground text-sm">
          Audit trail real-time untuk login, manajemen user, transaksi, dan error operasional.
        </p>
      </div>

      <Card className="border-emerald-100/70 bg-white/95 dark:border-emerald-950/40 dark:bg-emerald-950/10">
        <CardHeader>
          <CardTitle>Filter Aktivitas</CardTitle>
          <CardDescription>
            Gunakan level dan kata kunci untuk menyaring log audit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="grid gap-3 md:grid-cols-[1fr_180px_auto_auto]" onSubmit={onFilterSubmit}>
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Cari aksi, modul, aktor, atau detail..."
            />
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={levelFilter}
              onChange={(event) => setLevelFilter(event.target.value as LevelFilter)}
            >
              {LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button type="submit">Terapkan</Button>
            <Button type="button" variant="outline" onClick={() => void loadLogs()}>
              Refresh
            </Button>
          </form>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className="border-border bg-muted text-foreground">
              Total {logs.length}
            </Badge>
            <Badge className={LEVEL_BADGE_CLASSNAME.INFO}>INFO {summary.info}</Badge>
            <Badge className={LEVEL_BADGE_CLASSNAME.WARN}>WARN {summary.warn}</Badge>
            <Badge className={LEVEL_BADGE_CLASSNAME.ERROR}>ERROR {summary.error}</Badge>
            {lastUpdatedAt ? (
              <span className="text-muted-foreground">Update {formatTimestamp(lastUpdatedAt)}</span>
            ) : null}
          </div>

          {errorMessage ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800 text-sm dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              {errorMessage}
            </div>
          ) : null}

          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <p className="font-medium text-sm text-foreground">Error Terkini</p>
            {latestErrors.length === 0 ? (
              <p className="mt-1 text-muted-foreground text-xs">
                Tidak ada error untuk filter saat ini.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {latestErrors.map((item) => (
                  <div key={item.id} className="rounded-md border bg-background px-2 py-2 text-xs">
                    <p className="font-medium text-foreground">{item.action}</p>
                    <p className="text-muted-foreground">{formatTimestamp(item.timestamp)} • {item.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-muted/70">
                  <tr className="text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Waktu</th>
                    <th className="px-3 py-2 font-medium">Aktor</th>
                    <th className="px-3 py-2 font-medium">Modul</th>
                    <th className="px-3 py-2 font-medium">Aksi</th>
                    <th className="px-3 py-2 font-medium">Detail Operasi</th>
                    <th className="px-3 py-2 font-medium">Sumber</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-background">
                  {isLoading && logs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                        Memuat activity log...
                      </td>
                    </tr>
                  ) : null}

                  {!isLoading && logs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                        Belum ada aktivitas yang tercatat untuk filter ini.
                      </td>
                    </tr>
                  ) : null}

                  {logs.map((log) => (
                    <tr key={log.id} className="align-top">
                      <td className="px-3 py-3 text-foreground">
                        {formatTimestamp(log.timestamp)}
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-foreground">{log.actorName}</p>
                        <p className="text-muted-foreground text-xs">{log.actorRole}</p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-mono text-muted-foreground text-xs">{log.module}</p>
                      </td>
                      <td className="px-3 py-3">
                        <Badge className={LEVEL_BADGE_CLASSNAME[log.level]}>{log.action}</Badge>
                      </td>
                      <td className="px-3 py-3 text-foreground text-sm">
                        {log.detail}
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-mono text-muted-foreground text-xs">{log.ip}</p>
                        <p className="mt-1 max-w-[280px] truncate text-muted-foreground text-xs">
                          {log.userAgent}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
