"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type {
  DemoMedicineMovementType,
  DemoMedicineTransaction,
  DemoStockItem,
} from "@/lib/demo/types";

interface TransactionsResponse {
  transactions: DemoMedicineTransaction[];
}

interface StockResponse {
  items: DemoStockItem[];
}

function movementLabel(movementType: DemoMedicineMovementType): string {
  if (movementType === "keluar") {
    return "Keluar";
  }

  if (movementType === "masuk") {
    return "Masuk";
  }

  if (movementType === "adjustment") {
    return "Adjustment";
  }

  if (movementType === "kadaluarsa") {
    return "Kadaluarsa";
  }

  return "Retur";
}

function movementBadgeClass(movementType: DemoMedicineMovementType): string {
  if (movementType === "keluar") {
    return "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200";
  }

  if (movementType === "masuk") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200";
  }

  if (movementType === "adjustment") {
    return "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200";
  }

  if (movementType === "kadaluarsa") {
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
  }

  return "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200";
}

function referenceTypeLabel(referenceType: DemoMedicineTransaction["referenceType"]): string {
  if (referenceType === "dispensing") {
    return "Dispensing";
  }

  if (referenceType === "stock-opname") {
    return "Stock Opname";
  }

  return "Manual";
}

function sourceLabel(source?: DemoStockItem["source"]): string {
  if (source === "kronis_rsi") {
    return "Obat Kronis RSI";
  }

  if (source === "efornas") {
    return "e-Fornas";
  }

  return "Operasional";
}

interface MedicineTransactionsPanelProps {
  title?: string;
  description?: string;
  defaultLimit?: number;
  enableDetailDrawer?: boolean;
  defaultQuery?: string;
  autoRefreshMs?: number;
}

function buildTransactionNumber(item: DemoMedicineTransaction): string {
  const timestamp = new Date(item.occurredAt);
  const datePart = Number.isNaN(timestamp.getTime())
    ? "00000000"
    : `${timestamp.getFullYear()}${String(timestamp.getMonth() + 1).padStart(2, "0")}${String(
        timestamp.getDate(),
      ).padStart(2, "0")}`;

  const idPart = item.id.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(-6) || "000000";
  return `TRX-${datePart}-${idPart}`;
}

export function MedicineTransactionsPanel({
  title = "Riwayat Transaksi Obat",
  description = "Pantau mutasi stok obat berdasarkan nomor obat dan histori pergerakannya.",
  defaultLimit = 200,
  enableDetailDrawer = false,
  defaultQuery = "",
  autoRefreshMs,
}: MedicineTransactionsPanelProps) {
  const [transactions, setTransactions] = useState<DemoMedicineTransaction[]>([]);
  const [stockByNomorObat, setStockByNomorObat] = useState<Record<string, DemoStockItem>>({});
  const [selectedTransaction, setSelectedTransaction] = useState<DemoMedicineTransaction | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [searchInput, setSearchInput] = useState(defaultQuery);
  const [searchQuery, setSearchQuery] = useState(defaultQuery);

  const loadTransactions = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const params = new URLSearchParams({
        limit: String(defaultLimit),
      });

      if (searchQuery.trim()) {
        params.set("query", searchQuery.trim().toUpperCase());
      }

      const [transactionsResponse, stockResponse] = await Promise.all([
        fetch(`/api/demo/apoteker/transaksi-obat?${params.toString()}`, {
          cache: "no-store",
        }),
        enableDetailDrawer
          ? fetch("/api/demo/apoteker/stok?includeCatalog=true", {
              cache: "no-store",
            })
          : Promise.resolve(null),
      ]);

      const payload = (await transactionsResponse.json()) as TransactionsResponse & {
        error?: string;
      };

      if (!transactionsResponse.ok) {
        throw new Error(payload.error || "Gagal mengambil transaksi obat.");
      }

      setTransactions(payload.transactions);

      if (enableDetailDrawer) {
        if (stockResponse && stockResponse.ok) {
          const stockPayload = (await stockResponse.json()) as StockResponse;
          const lookup = stockPayload.items.reduce<Record<string, DemoStockItem>>((acc, item) => {
            const key = item.nomorObat?.trim().toUpperCase();
            if (key && !acc[key]) {
              acc[key] = item;
            }

            return acc;
          }, {});

          setStockByNomorObat(lookup);
        } else {
          setStockByNomorObat({});
        }
      }

      setLastUpdatedAt(new Date().toISOString());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Terjadi kesalahan.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, [defaultLimit, enableDetailDrawer, searchQuery]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    if (!selectedTransaction) {
      return;
    }

    const isStillPresent = transactions.some((item) => item.id === selectedTransaction.id);
    if (!isStillPresent) {
      setSelectedTransaction(null);
    }
  }, [selectedTransaction, transactions]);

  useEffect(() => {
    if (!autoRefreshMs || autoRefreshMs < 1000) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadTransactions();
    }, autoRefreshMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [autoRefreshMs, loadTransactions]);

  const summary = useMemo(() => {
    return transactions.reduce(
      (accumulator, item) => {
        accumulator.total += 1;

        if (item.movementType === "keluar") {
          accumulator.keluar += 1;
        } else if (item.movementType === "masuk") {
          accumulator.masuk += 1;
        } else {
          accumulator.lainnya += 1;
        }

        return accumulator;
      },
      {
        total: 0,
        keluar: 0,
        masuk: 0,
        lainnya: 0,
      },
    );
  }, [transactions]);

  const updatedLabel =
    lastUpdatedAt.length > 0
      ? new Date(lastUpdatedAt).toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "-";

  function onFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchQuery(searchInput.trim().toUpperCase());
  }

  function resetFilter() {
    setSearchInput("");
    setSearchQuery("");
  }

  function openTransactionDetail(item: DemoMedicineTransaction) {
    if (!enableDetailDrawer) {
      return;
    }

    setSelectedTransaction(item);
  }

  function onTransactionRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement>,
    item: DemoMedicineTransaction,
  ) {
    if (!enableDetailDrawer) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedTransaction(item);
    }
  }

  const selectedMedicine = selectedTransaction
    ? stockByNomorObat[selectedTransaction.nomorObat.trim().toUpperCase()]
    : null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="grid gap-3 md:grid-cols-[1fr_auto_auto]" onSubmit={onFilterSubmit}>
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Filter nomor obat / nomor transaksi / referensi"
            />
            <Button type="submit">Terapkan</Button>
            <Button type="button" variant="outline" onClick={resetFilter}>
              Reset
            </Button>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-border bg-muted text-foreground">
                Total {summary.total}
              </Badge>
              <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                Masuk {summary.masuk}
              </Badge>
              <Badge className="border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                Keluar {summary.keluar}
              </Badge>
              <Badge className="border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
                Lainnya {summary.lainnya}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-muted-foreground text-xs">Terakhir sinkron: {updatedLabel}</p>
              <Button type="button" variant="outline" onClick={() => void loadTransactions()}>
                Muat Ulang
              </Button>
            </div>
          </div>

          {errorMessage ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800 text-sm dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {errorMessage}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead className="bg-muted/60">
                <tr>
                  <th className="px-3 py-2">Nomor Transaksi</th>
                  <th className="px-3 py-2">Waktu</th>
                  <th className="px-3 py-2">Nomor Obat</th>
                  <th className="px-3 py-2">Jenis Mutasi</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Sebelum → Sesudah</th>
                  <th className="px-3 py-2">Referensi</th>
                  <th className="px-3 py-2">Catatan</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr className="border-t">
                    <td className="px-3 py-6 text-center text-muted-foreground text-sm" colSpan={8}>
                      Memuat transaksi obat...
                    </td>
                  </tr>
                ) : transactions.length === 0 ? (
                  <tr className="border-t">
                    <td className="px-3 py-6 text-center text-muted-foreground text-sm" colSpan={8}>
                      Tidak ada transaksi obat untuk filter saat ini.
                    </td>
                  </tr>
                ) : (
                  transactions.map((item) => {
                    const medicine = stockByNomorObat[item.nomorObat.trim().toUpperCase()];
                    return (
                      <tr
                        key={item.id}
                        className={`border-t align-top ${
                          enableDetailDrawer ? "cursor-pointer hover:bg-muted/30" : ""
                        }`}
                        onClick={() => openTransactionDetail(item)}
                        onKeyDown={(event) => onTransactionRowKeyDown(event, item)}
                        role={enableDetailDrawer ? "button" : undefined}
                        tabIndex={enableDetailDrawer ? 0 : undefined}
                      >
                        <td className="px-3 py-2">
                          <p className="font-mono text-xs">{buildTransactionNumber(item)}</p>
                          <p className="text-muted-foreground text-xs">ID {item.id}</p>
                        </td>
                        <td className="px-3 py-2">
                          {new Date(item.occurredAt).toLocaleString("id-ID")}
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-mono">{item.nomorObat}</p>
                          {medicine ? (
                            <p className="text-muted-foreground text-xs">{medicine.nama}</p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <Badge className={movementBadgeClass(item.movementType)}>
                            {movementLabel(item.movementType)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">{item.quantity}</td>
                        <td className="px-3 py-2">
                          {item.beforeQty} → {item.afterQty}
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-mono text-xs">{referenceTypeLabel(item.referenceType)}</p>
                          <p className="text-muted-foreground text-xs">{item.referenceId || "-"}</p>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">
                          {item.note || "-"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Sheet
        open={Boolean(selectedTransaction)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedTransaction(null);
          }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Detail Transaksi Obat</SheetTitle>
            <SheetDescription>
              Detail mutasi stok dan referensi transaksi untuk audit admin.
            </SheetDescription>
          </SheetHeader>

          {selectedTransaction ? (
            <div className="space-y-4 px-4 pb-6 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-muted-foreground text-xs">Nomor Transaksi</p>
                  <p className="mt-1 font-mono text-xs">
                    {buildTransactionNumber(selectedTransaction)}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">ID: {selectedTransaction.id}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-muted-foreground text-xs">Waktu Transaksi</p>
                  <p className="mt-1 font-medium">
                    {new Date(selectedTransaction.occurredAt).toLocaleString("id-ID")}
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-muted-foreground text-xs">Jenis Mutasi</p>
                  <div className="mt-1">
                    <Badge className={movementBadgeClass(selectedTransaction.movementType)}>
                      {movementLabel(selectedTransaction.movementType)}
                    </Badge>
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-muted-foreground text-xs">Nomor Obat</p>
                  <p className="mt-1 font-mono">{selectedTransaction.nomorObat}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-muted-foreground text-xs">Jumlah Mutasi</p>
                  <p className="mt-1 font-medium">{selectedTransaction.quantity}</p>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-muted-foreground text-xs">Perubahan Stok</p>
                <p className="mt-1 font-medium">
                  {selectedTransaction.beforeQty} → {selectedTransaction.afterQty}
                </p>
              </div>

              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-muted-foreground text-xs">Referensi Transaksi</p>
                <p className="mt-1 font-medium">
                  {referenceTypeLabel(selectedTransaction.referenceType)}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  ID: {selectedTransaction.referenceId || "-"}
                </p>
              </div>

              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-muted-foreground text-xs">Catatan</p>
                <p className="mt-1 leading-relaxed">{selectedTransaction.note || "-"}</p>
              </div>

              {selectedMedicine ? (
                <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                  <p className="text-muted-foreground text-xs">Informasi Obat Terkait</p>
                  <p className="font-medium">{selectedMedicine.nama}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <p>
                      <span className="text-muted-foreground">Sumber:</span>{" "}
                      {sourceLabel(selectedMedicine.source)}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Stok Saat Ini:</span>{" "}
                      {selectedMedicine.stok} {selectedMedicine.satuan}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Lokasi:</span>{" "}
                      {selectedMedicine.lokasi || "-"}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Kadaluarsa:</span>{" "}
                      {selectedMedicine.expiredAt || "-"}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
