export type DemoStockStatus = "aman" | "menipis" | "kritis";

export type DemoMedicineDataSource =
  | "operasional"
  | "kronis_rsi"
  | "efornas";

export interface DemoStockItem {
  id: string;
  nomorObat?: string;
  nama: string;
  stok: number;
  satuan: string;
  expiredAt: string;
  lokasi: string;
  status: DemoStockStatus;
  source?: DemoMedicineDataSource;
  detailSummary?: string;
  restriksi?: string;
  peresepanMaksimal?: string;
  smf?: string;
  kelasTerapi?: string;
}

export interface DemoStockSummary {
  totalItems: number;
  totalUnits: number;
  menipisCount: number;
  kritisCount: number;
}

export type DemoDispensingStatus =
  | "diterima"
  | "diracik"
  | "siap_diserahkan"
  | "selesai";

export type DemoPaymentStatus =
  | "menunggu_bayar"
  | "lunas"
  | "gagal"
  | "dibatalkan"
  | "refund";

export type DemoPaymentMethod = "cash" | "debit" | "credit" | "bpjs" | "lainnya";

export type DemoDispensingWorkflowStatus =
  | "menunggu_validasi_resep"
  | "menunggu_pembayaran"
  | "siap_diracik"
  | "sedang_diracik"
  | "siap_diserahkan"
  | "diserahkan"
  | "cancel";

export interface DemoDispensingOrder {
  id: string;
  patientName: string;
  nomorRM?: string;
  nomorPeresepan?: string;
  nomorObat?: string;
  medicineName: string;
  dosage: string;
  quantity: number;
  status: DemoDispensingStatus;
  workflowStatus?: DemoDispensingWorkflowStatus;
  paymentStatus?: DemoPaymentStatus;
  cancelReason?: string;
  updatedAt?: string;
  createdAt: string;
}

export interface DemoPatientRecord {
  id: string;
  userId?: string;
  nomorRM: string;
  nama: string;
  createdAt: string;
  updatedAt: string;
}

export type DemoPrescriptionStatus =
  | "dibuat"
  | "tervalidasi_apotek"
  | "siap_proses"
  | "selesai"
  | "batal";

export interface DemoPrescriptionItem {
  id: string;
  nomorObat: string;
  medicineName: string;
  dosis: string;
  qty: number;
}

export interface DemoPrescriptionRecord {
  id: string;
  nomorPeresepan: string;
  nomorRM: string;
  patientName: string;
  doctorName: string;
  status: DemoPrescriptionStatus;
  createdAt: string;
  updatedAt: string;
  items: DemoPrescriptionItem[];
}

export interface DemoCashierPayment {
  id: string;
  nomorPeresepan: string;
  statusBayar: DemoPaymentStatus;
  totalTagihan: number;
  totalDibayar: number;
  metodeBayar?: DemoPaymentMethod;
  paidAt?: string;
  updatedAt: string;
}

export interface DemoPatientDispensingProgress {
  orderId: string;
  nomorObat?: string;
  medicineName: string;
  dosage: string;
  quantity: number;
  workflowStatus: DemoDispensingWorkflowStatus;
  updatedAt?: string;
}

export interface DemoPatientPaymentSummary {
  id: string;
  nomorPeresepan: string;
  nomorRM: string;
  patientName: string;
  doctorName: string;
  statusBayar: DemoPaymentStatus;
  totalTagihan: number;
  totalDibayar: number;
  sisaTagihan: number;
  metodeBayar?: DemoPaymentMethod;
  paidAt?: string;
  updatedAt: string;
  items: DemoPrescriptionItem[];
  dispensing: DemoPatientDispensingProgress[];
}

export type DemoMedicineMovementType =
  | "masuk"
  | "keluar"
  | "adjustment"
  | "kadaluarsa"
  | "retur";

export interface DemoMedicineTransaction {
  id: string;
  nomorObat: string;
  movementType: DemoMedicineMovementType;
  quantity: number;
  beforeQty: number;
  afterQty: number;
  referenceType: "dispensing" | "stock-opname" | "manual";
  referenceId?: string;
  actorUserId?: string;
  note?: string;
  occurredAt: string;
}

export type DemoValidationFlag = "ok" | "warning" | "critical";

export interface DemoPrescriptionCheck {
  name: string;
  flag: DemoValidationFlag;
  message: string;
}

export interface DemoPrescriptionValidationResult {
  checkedAt: string;
  checks: DemoPrescriptionCheck[];
  recommendation: string;
  canProceed: boolean;
}

export interface DemoLabelPreview {
  labelId: string;
  generatedAt: string;
  apotekName: string;
  patientName: string;
  medicineName: string;
  dosage: string;
  duration: string;
  instructions: string;
  barcode: string;
}

export interface DemoPatientMedicineInfo {
  id: string;
  nomorObat?: string;
  nomorPeresepan?: string;
  nama: string;
  aturan: string;
  stokStatus: string;
  dispensingWorkflowStatus?: DemoDispensingWorkflowStatus;
  dispensingUpdatedAt?: string;
  catatan: string;
  tujuanTerapi: string;
  waktuKonsumsi: string[];
  peringatan: string;
  tipsPenyimpanan: string;
}

export type DemoReminderChannel =
  | "aplikasi"
  | "email"
  | "sms"
  | "whatsapp"
  | "telegram";

export interface DemoReminder {
  id: string;
  userId: string;
  title: string;
  date: string;
  time: string;
  channel: DemoReminderChannel;
  note: string;
  createdAt: string;
}

export type DemoInsuranceProvider = "bpjs" | "swasta";

export interface DemoInsuranceResult {
  provider: DemoInsuranceProvider;
  memberId: string;
  serviceType: string;
  approved: boolean;
  estimatedCoveragePercent: number;
  coverage: string;
  note: string;
  checkedAt: string;
}

export interface DemoCatatanAsuhanApoteker {
  id: string;
  nomorRM: string;
  obatId: number | null;
  obatKode: string | null;
  namaObat: string | null;
  kategori: string | null;
  catatan: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDemoCatatanAsuhanApotekerInput {
  nomorRM: string;
  obatId: number;
  catatan: string;
}

export interface ListDemoCatatanAsuhanApotekerOptions {
  nomorRM?: string;
  obatId?: number;
}