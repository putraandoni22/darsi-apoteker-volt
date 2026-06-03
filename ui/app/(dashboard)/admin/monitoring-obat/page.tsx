import { StockMonitoringPanel } from "@/components/demo/stock-monitoring-panel";

export default function AdminMonitoringObatPage() {
	return (
		<div className="space-y-6">
			<div>
				<h1 className="font-semibold text-2xl text-foreground">
					Manajemen Obat
				</h1>
				<p className="text-muted-foreground text-sm">
					Kelola daftar obat dari katalog Obat Kronis RSI dan e-Fornas dengan
					pagination untuk akses lebih ringan.
				</p>
			</div>

			<StockMonitoringPanel
				title="Manajemen Obat"
				description="Daftar obat terintegrasi dari stok operasional, katalog obat kronis RSI, dan e-Fornas. Lengkap dengan monitoring batch dan kedaluwarsa H-90."
				includeCatalogData
				showMovementSummary
				showExpiryInsights
				enableMedicineDetailDrawer
			/>
		</div>
	);
}
