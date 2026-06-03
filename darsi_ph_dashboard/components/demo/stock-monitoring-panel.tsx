"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
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
	DemoMedicineDataSource,
	DemoMedicineTransaction,
	DemoStockItem,
	DemoStockSummary,
} from "@/lib/demo/types";

interface StockResponse {
	summary: DemoStockSummary;
	expirySummary?: {
		totalWithDate: number;
		h90Count: number;
		expiredCount: number;
	};
	items: DemoStockItem[];
	filters?: {
		nomorObat?: string;
		includeCatalog?: boolean;
	};
	pagination?: {
		page: number;
		pageSize: number;
		totalItems: number;
		totalPages: number;
		hasPreviousPage: boolean;
		hasNextPage: boolean;
	};
}

interface TransactionsResponse {
	transactions: DemoMedicineTransaction[];
}

interface MovementSummary {
	total: number;
	masuk: number;
	keluar: number;
	lainnya: number;
}

const STOCK_PAGE_SIZE = 10;

function statusBadge(status: DemoStockItem["status"]): {
	text: string;
	className: string;
} {
	if (status === "kritis") {
		return {
			text: "Kritis",
			className:
				"border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
		};
	}

	if (status === "menipis") {
		return {
			text: "Menipis",
			className:
				"border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
		};
	}

	return {
		text: "Aman",
		className:
			"border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
	};
}

function sourceLabel(source?: DemoMedicineDataSource): string {
	if (source === "kronis_rsi") {
		return "Obat Kronis RSI";
	}

	if (source === "efornas") {
		return "e-Fornas";
	}

	return "Operasional";
}

function sourceBadgeClass(source?: DemoMedicineDataSource): string {
	if (source === "kronis_rsi") {
		return "border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200";
	}

	if (source === "efornas") {
		return "border-violet-200 bg-violet-100 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200";
	}

	return "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200";
}

interface StockMonitoringPanelProps {
	title?: string;
	description?: string;
	includeCatalogData?: boolean;
	showMovementSummary?: boolean;
	enableMedicineDetailDrawer?: boolean;
	showExpiryInsights?: boolean;
	autoRefreshMs?: number;
}

function deriveBatchCode(item: DemoStockItem): string {
	const rawId = item.id.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(-6) || "000000";
	const rawNomor = (item.nomorObat ?? "OBAT")
		.replace(/[^a-zA-Z0-9]/g, "")
		.toUpperCase()
		.slice(-4) || "0000";

	return `BTH-${rawNomor}-${rawId}`;
}

function parseExpiryDate(value: string): Date | null {
	const normalized = value.trim();
	if (!normalized || normalized.toUpperCase() === "N/A") {
		return null;
	}

	const parsed = new Date(normalized);
	if (Number.isNaN(parsed.getTime())) {
		return null;
	}

	return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function formatDaysUntilExpiry(expiredAt: string): string {
	const expiryDate = parseExpiryDate(expiredAt);
	if (!expiryDate) {
		return "-";
	}

	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const dayDiff = Math.floor((expiryDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

	if (dayDiff < 0) {
		return `Lewat ${Math.abs(dayDiff)} hari`;
	}

	return `${dayDiff} hari`;
}

export function StockMonitoringPanel({
	title = "Ringkasan Stok Obat",
	description = "Pantau ketersediaan, kadaluarsa, dan lokasi obat secara terstruktur.",
	includeCatalogData = false,
	showMovementSummary = false,
	enableMedicineDetailDrawer = false,
	showExpiryInsights = false,
	autoRefreshMs,
}: StockMonitoringPanelProps) {
	const [summary, setSummary] = useState<DemoStockSummary | null>(null);
	const [items, setItems] = useState<DemoStockItem[]>([]);
	const [expirySummary, setExpirySummary] = useState({
		totalWithDate: 0,
		h90Count: 0,
		expiredCount: 0,
	});
	const [movementSummary, setMovementSummary] = useState<MovementSummary>({
		total: 0,
		masuk: 0,
		keluar: 0,
		lainnya: 0,
	});
	const [isLoading, setIsLoading] = useState(true);
	const [errorMessage, setErrorMessage] = useState("");
	const [lastUpdatedAt, setLastUpdatedAt] = useState("");
	const [nomorObatInput, setNomorObatInput] = useState("");
	const [nomorObatQuery, setNomorObatQuery] = useState("");
	const [currentPage, setCurrentPage] = useState(1);
	const [pagination, setPagination] = useState<StockResponse["pagination"]>();
	const [selectedItem, setSelectedItem] = useState<DemoStockItem | null>(null);

	const loadStock = useCallback(async () => {
		setIsLoading(true);
		setErrorMessage("");

		try {
			const params = new URLSearchParams();
			if (nomorObatQuery.trim().length > 0) {
				params.set("nomorObat", nomorObatQuery.trim().toUpperCase());
			}

			if (includeCatalogData) {
				params.set("includeCatalog", "true");
				params.set("page", String(currentPage));
				params.set("pageSize", String(STOCK_PAGE_SIZE));
			}

			const queryString = params.toString();
			const targetUrl = queryString
				? `/api/demo/apoteker/stok?${queryString}`
				: "/api/demo/apoteker/stok";

			const [stockResponse, transactionsResponse] = await Promise.all([
				fetch(targetUrl, { cache: "no-store" }),
				showMovementSummary
					? fetch("/api/demo/apoteker/transaksi-obat?limit=5000", {
							cache: "no-store",
						})
					: Promise.resolve(null),
			]);

			if (!stockResponse.ok) {
				throw new Error("Gagal mengambil data stok.");
			}

			const payload = (await stockResponse.json()) as StockResponse;
			setSummary(payload.summary);
			setItems(payload.items);
			setExpirySummary(
				payload.expirySummary ?? {
					totalWithDate: 0,
					h90Count: 0,
					expiredCount: 0,
				},
			);
			setNomorObatInput(payload.filters?.nomorObat ?? nomorObatQuery);
			setPagination(payload.pagination);

			if (payload.pagination && payload.pagination.page !== currentPage) {
				setCurrentPage(payload.pagination.page);
			}

			if (showMovementSummary) {
				if (transactionsResponse?.ok) {
					const transactionPayload =
						(await transactionsResponse.json()) as TransactionsResponse;

					const nextSummary =
						transactionPayload.transactions.reduce<MovementSummary>(
							(accumulator, transaction) => {
								const quantity = Number.isFinite(transaction.quantity)
									? Math.max(0, Math.round(transaction.quantity))
									: 0;

								accumulator.total += quantity;

								if (transaction.movementType === "masuk") {
									accumulator.masuk += quantity;
								} else if (transaction.movementType === "keluar") {
									accumulator.keluar += quantity;
								} else {
									accumulator.lainnya += quantity;
								}

								return accumulator;
							},
							{
								total: 0,
								masuk: 0,
								keluar: 0,
								lainnya: 0,
							},
						);

					setMovementSummary(nextSummary);
				} else {
					setMovementSummary({
						total: 0,
						masuk: 0,
						keluar: 0,
						lainnya: 0,
					});
				}
			}

			setLastUpdatedAt(new Date().toISOString());
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Terjadi kesalahan.";
			setErrorMessage(message);
		} finally {
			setIsLoading(false);
		}
	}, [currentPage, includeCatalogData, nomorObatQuery, showMovementSummary]);

	useEffect(() => {
		void loadStock();
	}, [loadStock]);

	useEffect(() => {
		if (!autoRefreshMs || autoRefreshMs < 1000) {
			return;
		}

		const timer = window.setInterval(() => {
			void loadStock();
		}, autoRefreshMs);

		return () => {
			window.clearInterval(timer);
		};
	}, [autoRefreshMs, loadStock]);

	const updatedLabel =
		lastUpdatedAt.length > 0
			? new Date(lastUpdatedAt).toLocaleTimeString("id-ID", {
					hour: "2-digit",
					minute: "2-digit",
				})
			: "-";

	function onSubmitFilter(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setCurrentPage(1);
		setNomorObatQuery(nomorObatInput.trim().toUpperCase());
	}

	function onResetFilter() {
		setNomorObatInput("");
		setCurrentPage(1);
		setNomorObatQuery("");
	}

	const tableColumnCount = includeCatalogData ? 8 : 7;
	const currentPagination = pagination;
	const displayStart = currentPagination
		? currentPagination.totalItems > 0
			? (currentPagination.page - 1) * currentPagination.pageSize + 1
			: 0
		: 0;
	const displayEnd = currentPagination
		? displayStart > 0
			? displayStart + items.length - 1
			: 0
		: 0;

	return (
		<div className="space-y-6">
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Total Item</CardDescription>
						<CardTitle className="text-2xl">
							{summary?.totalItems ?? "-"}
						</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Total Unit</CardDescription>
						<CardTitle className="text-2xl">
							{summary?.totalUnits ?? "-"}
						</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Stok Menipis</CardDescription>
						<CardTitle className="text-2xl">
							{summary?.menipisCount ?? "-"}
						</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Stok Kritis</CardDescription>
						<CardTitle className="text-2xl">
							{summary?.kritisCount ?? "-"}
						</CardTitle>
					</CardHeader>
				</Card>
				{showMovementSummary ? (
					<>
						<Card>
							<CardHeader className="pb-2">
								<CardDescription>Unit Obat Masuk</CardDescription>
								<CardTitle className="text-2xl">
									{movementSummary.masuk}
								</CardTitle>
							</CardHeader>
						</Card>
						<Card>
							<CardHeader className="pb-2">
								<CardDescription>Unit Obat Keluar</CardDescription>
								<CardTitle className="text-2xl">
									{movementSummary.keluar}
								</CardTitle>
							</CardHeader>
						</Card>
					</>
				) : null}
				{showExpiryInsights ? (
					<>
						<Card>
							<CardHeader className="pb-2">
								<CardDescription>Batch H-90</CardDescription>
								<CardTitle className="text-2xl">{expirySummary.h90Count}</CardTitle>
							</CardHeader>
						</Card>
						<Card>
							<CardHeader className="pb-2">
								<CardDescription>Sudah Kedaluwarsa</CardDescription>
								<CardTitle className="text-2xl">{expirySummary.expiredCount}</CardTitle>
							</CardHeader>
						</Card>
					</>
				) : null}
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{title}</CardTitle>
					<CardDescription>{description}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{includeCatalogData ? (
						<div className="rounded-md border border-emerald-200/70 bg-emerald-50/70 px-3 py-2 text-emerald-900 text-xs dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-100">
							Cari obat bisa pakai nomor obat (contoh: EFR-03415 atau KRN-0039)
							atau nama obat (contoh: parasetamol/amlodipin).
						</div>
					) : null}

					<form
						className="grid gap-3 md:grid-cols-[1fr_auto_auto]"
						onSubmit={onSubmitFilter}
					>
						<Input
							value={nomorObatInput}
							onChange={(event) => setNomorObatInput(event.target.value)}
							placeholder="Filter nomor obat atau nama obat"
						/>
						<Button type="submit">Terapkan</Button>
						<Button type="button" variant="outline" onClick={onResetFilter}>
							Reset
						</Button>
					</form>

					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="text-muted-foreground text-xs">
							Terakhir sinkron: {updatedLabel}
						</p>
						<Button
							type="button"
							variant="outline"
							onClick={() => void loadStock()}
						>
							Muat Ulang
						</Button>
					</div>

					{errorMessage ? (
						<div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800 text-sm dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
							{errorMessage}
						</div>
					) : null}

					<div className="overflow-x-auto rounded-lg border">
						<table className="w-full min-w-[1000px] text-left text-sm">
							<thead className="bg-muted/60">
								<tr>
									<th className="px-3 py-2">Batch</th>
									<th className="px-3 py-2">Nomor Obat</th>
									<th className="px-3 py-2">Obat</th>
									<th className="px-3 py-2">Stok</th>
									<th className="px-3 py-2">Kadaluarsa</th>
									<th className="px-3 py-2">Lokasi</th>
									{includeCatalogData ? (
										<th className="px-3 py-2">Sumber</th>
									) : null}
									<th className="px-3 py-2">Status</th>
								</tr>
							</thead>
							<tbody>
								{isLoading ? (
									<tr className="border-t">
										<td
											className="px-3 py-6 text-center text-muted-foreground text-sm"
											colSpan={tableColumnCount}
										>
											Memuat data stok...
										</td>
									</tr>
								) : items.length === 0 ? (
									<tr className="border-t">
										<td
											className="px-3 py-6 text-center text-muted-foreground text-sm"
											colSpan={tableColumnCount}
										>
											{nomorObatQuery.trim().length > 0
												? `Tidak ada data obat untuk filter ${nomorObatQuery}.`
												: "Belum ada data stok."}
										</td>
									</tr>
								) : (
									items.map((row) => {
										const status = statusBadge(row.status);
										return (
											<tr key={row.id} className="border-t">
												<td className="px-3 py-2 font-mono text-xs">
													{deriveBatchCode(row)}
												</td>
												<td className="px-3 py-2 font-mono">
													{(row.nomorObat ?? "").trim().length > 0
														? row.nomorObat
														: "-"}
												</td>
												<td className="px-3 py-2">
													{enableMedicineDetailDrawer ? (
														<button
															type="button"
															className="text-left font-medium text-emerald-700 underline decoration-dotted underline-offset-2 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
															onClick={() => setSelectedItem(row)}
														>
															{row.nama}
														</button>
													) : (
														row.nama
													)}
												</td>
												<td className="px-3 py-2">
													{row.stok} {row.satuan}
												</td>
												<td className="px-3 py-2">{row.expiredAt}</td>
												<td className="px-3 py-2">{row.lokasi}</td>
												{includeCatalogData ? (
													<td className="px-3 py-2">
														<Badge className={sourceBadgeClass(row.source)}>
															{sourceLabel(row.source)}
														</Badge>
													</td>
												) : null}
												<td className="px-3 py-2">
													<Badge className={status.className}>
														{status.text}
													</Badge>
												</td>
											</tr>
										);
									})
								)}
							</tbody>
						</table>
					</div>

					{includeCatalogData && currentPagination ? (
						<div className="flex flex-wrap items-center justify-between gap-3">
							<p className="text-muted-foreground text-xs">
								{currentPagination.totalItems > 0
									? `Menampilkan ${displayStart}-${displayEnd} dari ${currentPagination.totalItems} obat.`
									: "Tidak ada data obat."}
							</p>
							<div className="flex items-center gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={isLoading || !currentPagination.hasPreviousPage}
									onClick={() => {
										if (!currentPagination.hasPreviousPage) {
											return;
										}

										setCurrentPage((previousPage) =>
											Math.max(1, previousPage - 1),
										);
									}}
								>
									Sebelumnya
								</Button>
								<span className="text-muted-foreground text-xs">
									Halaman {currentPagination.page} dari{" "}
									{currentPagination.totalPages}
								</span>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={isLoading || !currentPagination.hasNextPage}
									onClick={() => {
										if (!currentPagination.hasNextPage) {
											return;
										}

										setCurrentPage((previousPage) => previousPage + 1);
									}}
								>
									Berikutnya
								</Button>
							</div>
						</div>
					) : null}
				</CardContent>
			</Card>

			<Sheet
				open={Boolean(selectedItem)}
				onOpenChange={(open) => {
					if (!open) {
						setSelectedItem(null);
					}
				}}
			>
				<SheetContent side="right" className="w-full sm:max-w-xl">
					<SheetHeader>
						<SheetTitle>{selectedItem?.nama ?? "Detail Obat"}</SheetTitle>
						<SheetDescription>
							Informasi lengkap obat untuk kebutuhan manajemen dan audit admin.
						</SheetDescription>
					</SheetHeader>

					{selectedItem ? (
						<div className="space-y-4 px-4 pb-6">
							<div className="grid grid-cols-2 gap-3 text-sm">
								<div className="rounded-lg border bg-muted/30 p-3">
									<p className="text-muted-foreground text-xs">Batch</p>
									<p className="mt-1 font-mono text-xs">{deriveBatchCode(selectedItem)}</p>
								</div>
								<div className="rounded-lg border bg-muted/30 p-3">
									<p className="text-muted-foreground text-xs">Nomor Obat</p>
									<p className="mt-1 font-mono text-sm">
										{selectedItem.nomorObat ?? "-"}
									</p>
								</div>
								<div className="rounded-lg border bg-muted/30 p-3">
									<p className="text-muted-foreground text-xs">Sumber Data</p>
									<p className="mt-1 font-medium">
										{sourceLabel(selectedItem.source)}
									</p>
								</div>
								<div className="rounded-lg border bg-muted/30 p-3">
									<p className="text-muted-foreground text-xs">Stok & Satuan</p>
									<p className="mt-1 font-medium">
										{selectedItem.stok} {selectedItem.satuan}
									</p>
								</div>
								<div className="rounded-lg border bg-muted/30 p-3">
									<p className="text-muted-foreground text-xs">Status Stok</p>
									<p className="mt-1 font-medium">
										{statusBadge(selectedItem.status).text}
									</p>
								</div>
								<div className="rounded-lg border bg-muted/30 p-3">
									<p className="text-muted-foreground text-xs">Lokasi</p>
									<p className="mt-1 font-medium">
										{selectedItem.lokasi || "-"}
									</p>
								</div>
								<div className="rounded-lg border bg-muted/30 p-3">
									<p className="text-muted-foreground text-xs">Kadaluarsa</p>
									<p className="mt-1 font-medium">
										{selectedItem.expiredAt || "-"}
									</p>
									<p className="text-muted-foreground mt-1 text-xs">
										Sisa {formatDaysUntilExpiry(selectedItem.expiredAt)}
									</p>
								</div>
							</div>

							<div className="space-y-3 rounded-lg border bg-muted/20 p-3 text-sm">
								<div>
									<p className="text-muted-foreground text-xs">
										Keterangan Obat
									</p>
									<p className="mt-1 leading-relaxed">
										{selectedItem.detailSummary ||
											"Tidak ada keterangan tambahan."}
									</p>
								</div>

								<div>
									<p className="text-muted-foreground text-xs">Kelas Terapi</p>
									<p className="mt-1 leading-relaxed">
										{selectedItem.kelasTerapi || "-"}
									</p>
								</div>

								<div>
									<p className="text-muted-foreground text-xs">Restriksi</p>
									<p className="mt-1 leading-relaxed">
										{selectedItem.restriksi || "-"}
									</p>
								</div>

								<div>
									<p className="text-muted-foreground text-xs">
										Peresepan Maksimal
									</p>
									<p className="mt-1 leading-relaxed">
										{selectedItem.peresepanMaksimal || "-"}
									</p>
								</div>

								<div>
									<p className="text-muted-foreground text-xs">SMF</p>
									<p className="mt-1 leading-relaxed">
										{selectedItem.smf || "-"}
									</p>
								</div>
							</div>
						</div>
					) : null}
				</SheetContent>
			</Sheet>
		</div>
	);
}
