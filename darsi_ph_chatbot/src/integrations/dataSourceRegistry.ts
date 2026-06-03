export type DataSourceStatus = "active" | "planned" | "inactive";

export interface DataSourceItem {
  key: string;
  name: string;
  status: DataSourceStatus;
  updateFrequency: string;
  priority: number;
  notes: string;
}

function envEnabled(name: string): boolean {
  return String(process.env[name] || "").toLowerCase() === "true";
}

export function getDataSourceRegistry(): DataSourceItem[] {
  return [
    {
      key: "rsi-kronis",
      name: "Database Obat Kronis RSI",
      status: "active",
      updateFrequency: "manual/perubahan data RSI",
      priority: 1,
      notes: "Sumber inti layanan apoteker RSI.",
    },
    {
      key: "efornas",
      name: "Database e-Fornas",
      status: "active",
      updateFrequency: "harian (disarankan)",
      priority: 2,
      notes: "Sudah terintegrasi, perlu sinkronisasi berkala.",
    },
    {
      key: "stok-obat",
      name: "Sistem Stok Obat",
      status: envEnabled("ENABLE_STOCK_SOURCE") ? "active" : "planned",
      updateFrequency: "real-time / near real-time",
      priority: 3,
      notes: "Untuk jawaban ketersediaan obat secara akurat.",
    },
    {
      key: "bpjs",
      name: "Sistem Asuransi BPJS",
      status: envEnabled("ENABLE_BPJS_SOURCE") ? "active" : "planned",
      updateFrequency: "harian",
      priority: 4,
      notes: "Untuk coverage BPJS dan aturan penjaminan.",
    },
    {
      key: "asuransi-swasta",
      name: "Sistem Asuransi Swasta",
      status: envEnabled("ENABLE_SWASTA_SOURCE") ? "active" : "planned",
      updateFrequency: "harian",
      priority: 5,
      notes: "Untuk manfaat non-BPJS.",
    },
    {
      key: "simrs-pasien",
      name: "Data Pasien SIMRS",
      status: envEnabled("ENABLE_SIMRS_SOURCE") ? "active" : "planned",
      updateFrequency: "real-time",
      priority: 6,
      notes: "Akses dibatasi untuk role internal berwenang.",
    },
    {
      key: "vendor-obat",
      name: "Sistem Vendor Obat",
      status: envEnabled("ENABLE_VENDOR_SOURCE") ? "active" : "planned",
      updateFrequency: "harian",
      priority: 7,
      notes: "Untuk lead time suplai dan alternatif substitusi.",
    },
  ];
}
