import { MedicineTransactionsPanel } from "@/components/demo/medicine-transactions-panel";
import { resolveApotekerPanelAutoRefreshMs } from "@/lib/apoteker/apoteker-runtime-config";

export default function ApotekerTransaksiObatPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">Daftar Transaksi Obat</h1>
        <p className="text-muted-foreground text-sm">
          Monitoring mutasi stok obat untuk alur dispensing dan audit internal apoteker.
        </p>
      </div>

      <MedicineTransactionsPanel
        description="Mutasi stok realtime untuk audit apoteker. Gunakan filter nomor obat/transaksi untuk pelacakan cepat."
        enableDetailDrawer
        autoRefreshMs={resolveApotekerPanelAutoRefreshMs()}
      />
    </div>
  );
}
