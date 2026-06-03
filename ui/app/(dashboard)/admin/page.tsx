import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { listActivityLogs, seedSystemActivityIfEmpty } from "@/lib/activity/store";
import { listPublicUsers } from "@/lib/auth/store";
import {
	buildStockSummary,
	listDispensingOrders,
	listMedicineTransactions,
	listStockItems,
} from "@/lib/demo/store";

function formatLocalTimestamp(iso: string): string {
	return new Date(iso).toLocaleString("id-ID", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export default async function AdminOverviewPage() {
	await seedSystemActivityIfEmpty();

	const [users, stockItems, dispensingOrders, transactions, logs] = await Promise.all([
		listPublicUsers(),
		listStockItems({ includeCatalog: true }),
		listDispensingOrders(),
		listMedicineTransactions({ limit: 600 }),
		listActivityLogs({ limit: 8 }),
	]);

	const stockSummary = buildStockSummary(stockItems);
	const roleCounter = users.reduce(
		(counter, user) => {
			counter[user.role] += 1;
			return counter;
		},
		{ admin: 0, apoteker: 0, pasien: 0 },
	);

	const activeDispensingCount = dispensingOrders.filter(
		(order) => order.status !== "selesai",
	).length;

	const nowMs = Date.now();
	const oneDayMs = 24 * 60 * 60 * 1000;
	const transactionsLast24h = transactions.filter((item) => {
		const occurredAtMs = new Date(item.occurredAt).getTime();
		if (!Number.isFinite(occurredAtMs)) {
			return false;
		}

		return nowMs - occurredAtMs <= oneDayMs;
	}).length;

	const metrics = [
		{
			label: "Total Pengguna",
			value: String(users.length),
			note: `Admin ${roleCounter.admin} • Apoteker ${roleCounter.apoteker} • Pasien ${roleCounter.pasien}`,
		},
		{
			label: "Stok Menipis / Kritis",
			value: `${stockSummary.menipisCount}/${stockSummary.kritisCount}`,
			note: `Total item ${stockSummary.totalItems} • Total unit ${stockSummary.totalUnits}`,
		},
		{
			label: "Transaksi 24 Jam",
			value: String(transactionsLast24h),
			note: `Total transaksi tercatat ${transactions.length}`,
		},
		{
			label: "Dispensing Aktif",
			value: String(activeDispensingCount),
			note: `Total order ${dispensingOrders.length} • Update ${formatLocalTimestamp(new Date().toISOString())}`,
		},
	];

	const adminModules = [
		{
			title: "Manajemen Obat",
			description:
				"Kelola stok, status kritis, kedaluwarsa H-90, serta ringkasan obat masuk dan keluar.",
			href: "/admin/monitoring-obat",
		},
		{
			title: "Daftar Transaksi Obat",
			description:
				"Pantau transaksi obat masuk dan keluar untuk kebutuhan audit operasional.",
			href: "/admin/transaksi-obat",
		},
		{
			title: "Manajemen User",
			description:
				"Atur akun admin, apoteker, dan pasien sesuai kebutuhan operasional RSI.",
			href: "/admin/users",
		},
		{
			title: "Log Aktivitas & Error",
			description:
				"Audit trail pengguna dan insiden error sistem untuk keamanan dan troubleshooting.",
			href: "/admin/logs",
		},
	];

	return (
		<div className="space-y-6">
			<div>
				<h1 className="font-semibold text-2xl text-foreground">
					Dashboard Admin DARSI Apoteker
				</h1>
				<p className="text-muted-foreground text-sm">
					Pusat ringkasan layanan admin untuk mengelola alur data yang saling
					terhubung antara Admin, Apoteker, dan Pasien.
				</p>
			</div>

			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				{metrics.map((item) => (
					<Card
						key={item.label}
						className="border-emerald-200/80 bg-white/95 dark:border-emerald-900/80 dark:bg-[#0f1a15]"
					>
						<CardHeader className="pb-2">
							<CardDescription>{item.label}</CardDescription>
							<CardTitle className="text-2xl">{item.value}</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="text-muted-foreground text-xs">{item.note}</p>
						</CardContent>
					</Card>
				))}
			</div>

			<Card className="border-emerald-200/80 bg-white/95 dark:border-emerald-900/80 dark:bg-[#0f1a15]">
				<CardHeader>
					<CardTitle>Panduan Singkat Penggunaan</CardTitle>
					<CardDescription>
						Urutan kerja yang direkomendasikan agar monitoring admin optimal.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-2 text-sm">
					<p>1. Gunakan Overview untuk membaca ringkasan KPI operasional harian.</p>
					<p>2. Kelola stok dan risiko obat melalui Manajemen Obat.</p>
					<p>3. Pantau Daftar Transaksi Obat untuk validasi pergerakan stok.</p>
					<p>4. Atur akun dan role petugas melalui Manajemen User.</p>
					<p>5. Audit kejadian sistem dan error dari Log Aktivitas & Error.</p>
				</CardContent>
			</Card>

			<div className="grid gap-4 md:grid-cols-2">
				{adminModules.map((module) => (
					<Card
						key={module.href}
						className="border-emerald-200/80 bg-white/95 dark:border-emerald-900/80 dark:bg-[#0f1a15]"
					>
						<CardHeader>
							<CardTitle>{module.title}</CardTitle>
							<CardDescription>{module.description}</CardDescription>
						</CardHeader>
						<CardContent>
							<Button
								asChild
								className="bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:from-emerald-400 hover:to-green-500"
							>
								<Link href={module.href}>Buka Modul</Link>
							</Button>
						</CardContent>
					</Card>
				))}
			</div>

			<Card className="border-emerald-200/80 bg-white/95 dark:border-emerald-900/80 dark:bg-[#0f1a15]">
				<CardHeader>
					<CardTitle>History Aktivitas Terbaru</CardTitle>
					<CardDescription>
						Riwayat singkat aktivitas sistem admin untuk validasi operasional harian.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-2">
					{logs.length === 0 ? (
						<p className="text-muted-foreground text-sm">Belum ada log aktivitas.</p>
					) : (
						logs.map((log) => (
							<div
								key={log.id}
								className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
							>
								<p className="font-medium text-foreground">
									[{log.level}] {log.action}
								</p>
								<p className="text-muted-foreground text-xs">
									{log.module} • {log.actorName} • {formatLocalTimestamp(log.timestamp)}
								</p>
							</div>
						))
					)}
				</CardContent>
			</Card>

			<Card className="border-emerald-200/80 bg-white/95 dark:border-emerald-900/80 dark:bg-[#0f1a15]">
				<CardHeader>
					<CardTitle>Aksi Cepat Admin</CardTitle>
					<CardDescription>
						Shortcut untuk modul yang paling sering dipakai setiap shift.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-wrap gap-2">
					<Button
						asChild
						variant="outline"
						className="border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-[#10201a] dark:text-emerald-200 dark:hover:bg-[#152922]"
					>
						<Link href="/admin">Overview</Link>
					</Button>
					<Button
						asChild
						variant="outline"
						className="border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-[#10201a] dark:text-emerald-200 dark:hover:bg-[#152922]"
					>
						<Link href="/admin/monitoring-obat">Manajemen Obat</Link>
					</Button>
					<Button
						asChild
						variant="outline"
						className="border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-[#10201a] dark:text-emerald-200 dark:hover:bg-[#152922]"
					>
						<Link href="/admin/transaksi-obat">Daftar Transaksi Obat</Link>
					</Button>
					<Button
						asChild
						className="bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:from-emerald-400 hover:to-green-500"
					>
						<Link href="/admin/users">Manajemen User</Link>
					</Button>
					<Button
						asChild
						variant="outline"
						className="border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-[#10201a] dark:text-emerald-200 dark:hover:bg-[#152922]"
					>
						<Link href="/admin/logs">Log Aktivitas & Error</Link>
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
