"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { DemoMedicineMovementType, DemoMedicineTransaction } from "@/lib/demo/types";

interface TransactionsResponse {
  transactions: DemoMedicineTransaction[];
}

type MovementFilter = DemoMedicineMovementType | "ALL";

const MOVEMENT_FILTER_OPTIONS: Array<{ value: MovementFilter; label: string }> = [
  { value: "ALL", label: "Semua Mutasi" },
  { value: "masuk", label: "Masuk" },
  { value: "keluar", label: "Keluar" },
  { value: "adjustment", label: "Adjustment" },
  { value: "kadaluarsa", label: "Kadaluarsa" },
  { value: "retur", label: "Retur" },
];

function asDateKey(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toCsv(rows: DemoMedicineTransaction[]): string {
  const header = [
    "nomor_transaksi",
    "tanggal",
    "nomor_obat",
    "jenis_mutasi",
    "qty",
    "stok_sebelum",
    "stok_sesudah",
    "referensi",
    "catatan",
  ];

  const body = rows.map((item) => [
    item.id,
    asDateKey(item.occurredAt),
    item.nomorObat,
    item.movementType,
    String(item.quantity),
    String(item.beforeQty),
    String(item.afterQty),
    item.referenceId || "-",
    item.note || "-",
  ]);

  const lines = [header, ...body].map((row) =>
    row
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(","),
  );

  return lines.join("\n");
}

export default function AdminReportsPage() {
  const [transactions, setTransactions] = useState<DemoMedicineTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [movementFilter, setMovementFilter] = useState<MovementFilter>("ALL");

  useEffect(() => {
    let ignore = false;

    async function loadData() {
      setIsLoading(true);
      setErrorMessage("");

      try {
        const response = await fetch("/api/demo/apoteker/transaksi-obat?limit=5000", {
          cache: "no-store",
        });
        const payload = (await response.json()) as TransactionsResponse & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || "Gagal memuat data laporan.");
        }

        if (!ignore) {
          setTransactions(payload.transactions);
        }
      } catch (error) {
        if (!ignore) {
          setErrorMessage(error instanceof Error ? error.message : "Terjadi kesalahan.");
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      ignore = true;
    };
  }, []);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((item) => {
      const dateKey = asDateKey(item.occurredAt);

      if (dateFrom && dateKey < dateFrom) {
        return false;
      }

      if (dateTo && dateKey > dateTo) {
        return false;
      }

      if (movementFilter !== "ALL" && item.movementType !== movementFilter) {
        return false;
      }

      return true;
    });
  }, [dateFrom, dateTo, movementFilter, transactions]);

  const reportSummary = useMemo(() => {
    return filteredTransactions.reduce(
      (accumulator, item) => {
        accumulator.total += 1;

        if (item.movementType === "masuk") {
          accumulator.masuk += 1;
        } else if (item.movementType === "keluar") {
          accumulator.keluar += 1;
        } else if (item.movementType === "kadaluarsa") {
          accumulator.kadaluarsa += 1;
        }

        return accumulator;
      },
      {
        total: 0,
        masuk: 0,
        keluar: 0,
        kadaluarsa: 0,
      },
    );
  }, [filteredTransactions]);

  function exportExcelCsv() {
    const csvContent = toCsv(filteredTransactions);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `laporan-transaksi-darsi-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function exportPdfPrint() {
    window.print();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">Laporan & Ekspor Data</h1>
        <p className="text-muted-foreground text-sm">
          Filter data transaksi obat berdasarkan periode dan jenis mutasi lalu ekspor untuk rapat.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Generator Laporan</CardTitle>
          <CardDescription>
            Tentukan rentang tanggal dan jenis transaksi sebelum mengekspor data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Tanggal Mulai</p>
              <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Tanggal Selesai</p>
              <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Jenis Mutasi</p>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={movementFilter}
                onChange={(event) => setMovementFilter(event.target.value as MovementFilter)}
              >
                {MOVEMENT_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDateFrom("");
                  setDateTo("");
                  setMovementFilter("ALL");
                }}
              >
                Reset Filter
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:from-emerald-400 hover:to-green-500"
              onClick={exportExcelCsv}
              disabled={filteredTransactions.length === 0}
            >
              Ekspor Excel (CSV)
            </Button>
            <Button type="button" variant="outline" onClick={exportPdfPrint}>
              Ekspor PDF (Print)
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Data</CardDescription>
            <CardTitle className="text-2xl">{reportSummary.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Mutasi Masuk</CardDescription>
            <CardTitle className="text-2xl">{reportSummary.masuk}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Mutasi Keluar</CardDescription>
            <CardTitle className="text-2xl">{reportSummary.keluar}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Kadaluarsa</CardDescription>
            <CardTitle className="text-2xl">{reportSummary.kadaluarsa}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Preview Laporan Transaksi</CardTitle>
          <CardDescription>Baris laporan yang akan ikut diekspor.</CardDescription>
        </CardHeader>
        <CardContent>
          {errorMessage ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800 text-sm dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              {errorMessage}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[940px] text-left text-sm">
              <thead className="bg-muted/60">
                <tr>
                  <th className="px-3 py-2">Nomor Transaksi</th>
                  <th className="px-3 py-2">Tanggal</th>
                  <th className="px-3 py-2">Nomor Obat</th>
                  <th className="px-3 py-2">Mutasi</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Sebelum → Sesudah</th>
                  <th className="px-3 py-2">Referensi</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr className="border-t">
                    <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      Memuat data laporan...
                    </td>
                  </tr>
                ) : filteredTransactions.length === 0 ? (
                  <tr className="border-t">
                    <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      Tidak ada data transaksi untuk filter saat ini.
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.slice(0, 250).map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">{item.id}</td>
                      <td className="px-3 py-2">{new Date(item.occurredAt).toLocaleString("id-ID")}</td>
                      <td className="px-3 py-2 font-mono">{item.nomorObat}</td>
                      <td className="px-3 py-2">{item.movementType}</td>
                      <td className="px-3 py-2">{item.quantity}</td>
                      <td className="px-3 py-2">{item.beforeQty} → {item.afterQty}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{item.referenceId || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
