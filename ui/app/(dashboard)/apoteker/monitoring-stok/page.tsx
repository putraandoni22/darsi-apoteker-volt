import { StockMonitoringPanel } from "@/components/demo/stock-monitoring-panel";
import { resolveApotekerPanelAutoRefreshMs } from "@/lib/apoteker/apoteker-runtime-config";

export default function MonitoringStokPage() {
	return (
		<div className="space-y-6">
			<div>
				<h1 className="font-semibold text-2xl text-foreground">
					Monitoring Stok Obat
				</h1>
				<p className="text-muted-foreground text-sm">
					Pantau ketersediaan obat berbasis katalog Obat Kronis RSI dan
					e-Fornas.
				</p>
			</div>

			<StockMonitoringPanel
				includeCatalogData
				title="Monitoring Stok Obat"
				description="Pantau stok obat lintas sumber secara realtime untuk mendukung validasi resep dan dispensing apoteker."
				showMovementSummary
				enableMedicineDetailDrawer
				autoRefreshMs={resolveApotekerPanelAutoRefreshMs()}
			/>
		</div>
	);
}
