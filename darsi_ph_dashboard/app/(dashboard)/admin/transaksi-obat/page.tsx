import { MedicineTransactionsPanel } from "@/components/demo/medicine-transactions-panel";

export default function AdminTransaksiObatPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">Monitoring Transaksi Obat</h1>
        <p className="text-muted-foreground text-sm">
          Audit mutasi stok lintas proses apoteker dan pasien dengan pelacakan nomor transaksi.
        </p>
      </div>

      <MedicineTransactionsPanel
        description="Riwayat mutasi stok lintas unit. Gunakan filter untuk nomor obat, nomor transaksi, atau referensi resep/dispensing."
        enableDetailDrawer
        autoRefreshMs={15000}
      />
    </div>
  );
}
