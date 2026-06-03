import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEMO_STORE_MIGRATION_META_KEY,
  demoCashierPaymentsTable,
  demoDispensingOrdersTable,
  demoMedicineTransactionsTable,
  demoPatientsTable,
  demoPrescriptionItemsTable,
  demoPrescriptionsTable,
  demoRemindersTable,
  demoStockItemsTable,
  getDemoDb,
  readDemoMetaValue,
  writeDemoMetaValue,
} from "@/lib/demo/db";
import { isApotekerAutoStoreCleanupEnabled } from "@/lib/apoteker/apoteker-runtime-config";
import {
  clearDispensingPgSnapshot,
  isDispensingPostgresActive,
  migrateDispensingFromSqliteIfNeeded,
  persistDispensingPgSnapshot,
  readDispensingPgSnapshot,
} from "@/lib/demo/dispensing-pg";
import type { DispensingWorkflowTransitionStatus } from "@/lib/demo/dispensing-workflow";
import type {
  DemoCashierPayment,
  DemoMedicineDataSource,
  DemoDispensingWorkflowStatus,
  DemoDispensingOrder,
  DemoInsuranceProvider,
  DemoInsuranceResult,
  DemoLabelPreview,
  DemoMedicineTransaction,
  DemoPaymentMethod,
  DemoPaymentStatus,
  DemoPatientMedicineInfo,
  DemoPatientDispensingProgress,
  DemoPatientPaymentSummary,
  DemoPatientRecord,
  DemoPrescriptionRecord,
  DemoPrescriptionValidationResult,
  DemoReminder,
  DemoReminderChannel,
  DemoStockItem,
  DemoStockSummary,
} from "@/lib/demo/types";

export type { DispensingWorkflowTransitionStatus } from "@/lib/demo/dispensing-workflow";

interface DemoWorkflowStore {
  stockItems: DemoStockItem[];
  dispensingOrders: DemoDispensingOrder[];
  reminders: DemoReminder[];
  patients: DemoPatientRecord[];
  prescriptions: DemoPrescriptionRecord[];
  cashierPayments: DemoCashierPayment[];
  medicineTransactions: DemoMedicineTransaction[];
}

export interface CreateDispensingInput {
  patientName?: string;
  patientUserId?: string;
  nomorRM?: string;
  nomorPeresepan?: string;
  nomorObat?: string;
  medicineName?: string;
  dosage?: string;
  quantity?: number;
  doctorName?: string;
  autoCreatePrescription?: boolean;
  allowCustomPrescriptionItem?: boolean;
  paymentStatus?: DemoPaymentStatus;
  actorUserId?: string;
}

export interface UpdateDispensingWorkflowInput {
  orderId: string;
  targetWorkflowStatus: DispensingWorkflowTransitionStatus;
  actorUserId?: string;
}

export interface UpdateDispensingOrderDetailsInput {
  orderId: string;
  nomorObat?: string;
  medicineName?: string;
  dosage?: string;
  quantity?: number;
  actorUserId?: string;
}

export interface CancelDispensingOrderInput {
  orderId: string;
  reason?: string;
  actorUserId?: string;
}

export type DispensingOrderManageErrorCode =
  | "order_not_found"
  | "order_locked"
  | "invalid_field"
  | "already_cancelled";

export interface DispensingOrderManageErrorDetails {
  code: DispensingOrderManageErrorCode;
  orderId?: string;
}

export class DispensingOrderManageError extends Error {
  readonly details: DispensingOrderManageErrorDetails;

  constructor(message: string, details: DispensingOrderManageErrorDetails) {
    super(message);
    this.name = "DispensingOrderManageError";
    this.details = details;
  }
}

export type DispensingPrescriptionErrorCode =
  | "nomor_rm_required"
  | "nomor_peresepan_required"
  | "prescription_not_found"
  | "manual_patient_required"
  | "manual_medicine_required"
  | "manual_dosage_required"
  | "manual_quantity_required"
  | "patient_mismatch"
  | "medicine_not_in_prescription"
  | "dosage_mismatch"
  | "quantity_mismatch"
  | "duplicate_dispensing_order";

export interface DispensingPrescriptionErrorDetails {
  code: DispensingPrescriptionErrorCode;
  nomorRM?: string;
  expectedNomorRM?: string;
  nomorPeresepan?: string;
  patientName?: string;
  expectedPatientName?: string;
  doctorName?: string;
  medicineName?: string;
  expectedMedicineName?: string;
  dosage?: string;
  expectedDosage?: string;
  quantity?: number;
  expectedQuantity?: number;
  existingOrderId?: string;
  existingWorkflowStatus?: DemoDispensingWorkflowStatus;
  existingPaymentStatus?: DemoPaymentStatus;
  availableMedicines?: Array<{
    nomorObat: string;
    medicineName: string;
    dosage: string;
    quantity: number;
  }>;
}

export interface DispensingPrescriptionLookupItem {
  nomorObat: string;
  medicineName: string;
  dosage: string;
  quantity: number;
  keteranganObat: string;
}

export interface DispensingPrescriptionLookupResult {
  nomorRM: string;
  nomorPeresepan: string;
  patientName: string;
  doctorName: string;
  status: DemoPrescriptionRecord["status"];
  items: DispensingPrescriptionLookupItem[];
}

export type DispensingWorkflowUpdateErrorCode =
  | "order_not_found"
  | "payment_not_completed"
  | "invalid_transition";

export interface DispensingWorkflowUpdateErrorDetails {
  code: DispensingWorkflowUpdateErrorCode;
  orderId?: string;
  currentWorkflowStatus?: DemoDispensingWorkflowStatus;
  targetWorkflowStatus?: DispensingWorkflowTransitionStatus;
  expectedNextWorkflowStatus?: DispensingWorkflowTransitionStatus;
  paymentStatus?: DemoPaymentStatus;
}

export class DispensingPrescriptionError extends Error {
  readonly details: DispensingPrescriptionErrorDetails;

  constructor(message: string, details: DispensingPrescriptionErrorDetails) {
    super(message);
    this.name = "DispensingPrescriptionError";
    this.details = details;
  }
}

export class DispensingWorkflowUpdateError extends Error {
  readonly details: DispensingWorkflowUpdateErrorDetails;

  constructor(message: string, details: DispensingWorkflowUpdateErrorDetails) {
    super(message);
    this.name = "DispensingWorkflowUpdateError";
    this.details = details;
  }
}

export class InsufficientStockError extends Error {
  readonly medicineName: string;
  readonly available: number;
  readonly requested: number;

  constructor(medicineName: string, available: number, requested: number) {
    super(
      `Stok ${medicineName} tidak mencukupi untuk dispensing. Tersedia ${available}, diminta ${requested}.`,
    );
    this.name = "InsufficientStockError";
    this.medicineName = medicineName;
    this.available = available;
    this.requested = requested;
  }
}

export interface ValidatePrescriptionInput {
  medicineName: string;
  dosage: string;
  frequency: string;
  allergies: string;
  companionMedicines: string;
  nomorObat?: string;
  quantity?: number;
  diagnosisSummary?: string;
  activeMedicines?: string;
}

export interface CreateLabelInput {
  patientName: string;
  medicineName: string;
  dosage: string;
  duration: string;
  instructions: string;
}

export interface CreateReminderInput {
  userId: string;
  title: string;
  date: string;
  time: string;
  channel: DemoReminderChannel;
  note: string;
}

export interface InsuranceCheckInput {
  provider: DemoInsuranceProvider;
  memberId: string;
  serviceType: string;
}

export interface ListPatientPrescriptionPaymentsOptions {
  nomorPeresepan?: string;
}

export interface ListPatientReceivedMedicineInfoOptions {
  nomorPeresepan?: string;
  patientUserId?: string;
  patientNomorRM?: string;
  patientName?: string;
}

export interface ConfirmPatientPaymentInput {
  nomorPeresepan: string;
  metodeBayar?: DemoPaymentMethod;
  actorUserId?: string;
}

export type ConfirmPatientPaymentDispensingInfo = DemoPatientDispensingProgress;

export interface ConfirmPatientPaymentResult {
  payment: DemoPatientPaymentSummary;
  updated: boolean;
  relatedOrderCount: number;
  dispensing: ConfirmPatientPaymentDispensingInfo[];
}

export interface ResetDispensingDataResult {
  deletedOrders: number;
  deletedPrescriptions: number;
  deletedPayments: number;
  deletedPatients: number;
  deletedTransactions: number;
}

const DATA_DIR = path.join(process.cwd(), "data");
const LEGACY_STORE_FILE = path.join(DATA_DIR, "demo-workflows.json");
const KRONIS_CSV_FILE = "DAFTAR_OBAT_KRONIS_CLEAN.csv";
const EFORNAS_CSV_FILE = "efornas_obat_lengkap.csv";
const EFORNAS_IMPORT_LIMIT = 1800;
const DEMO_STORE_MIGRATION_VALUE = "completed_v2_catalog_only";
const APOTEK_NAME = "APOTEK DARSI";
const DEFAULT_REMINDER_TIME = "08:00";
let writeQueue: Promise<void> = Promise.resolve();
let migrationPromise: Promise<void> | null = null;
let externalCatalogCache: DemoStockItem[] | null = null;
let externalCatalogPromise: Promise<DemoStockItem[]> | null = null;

const INITIAL_STORE: DemoWorkflowStore = {
  stockItems: [],
  dispensingOrders: [
    {
      id: "dsp-001",
      patientName: "Budi Santoso",
      nomorRM: "RM-0001",
      nomorPeresepan: "RSP-2026-0001",
      nomorObat: "EFR-03415",
      medicineName: "Paracetamol 500mg",
      dosage: "3x1 sesudah makan",
      quantity: 15,
      status: "siap_diserahkan",
      workflowStatus: "siap_diserahkan",
      paymentStatus: "lunas",
      updatedAt: "2026-04-07T08:45:00.000Z",
      createdAt: "2026-04-07T08:45:00.000Z",
    },
    {
      id: "dsp-002",
      patientName: "Siti Aminah",
      nomorRM: "RM-0002",
      nomorPeresepan: "RSP-2026-0002",
      nomorObat: "EFR-00155",
      medicineName: "Amlodipine 10mg",
      dosage: "1x1 pagi",
      quantity: 30,
      status: "diracik",
      workflowStatus: "sedang_diracik",
      paymentStatus: "lunas",
      updatedAt: "2026-04-07T09:10:00.000Z",
      createdAt: "2026-04-07T09:10:00.000Z",
    },
  ],
  reminders: [],
  patients: [
    {
      id: "pt-001",
      nomorRM: "RM-0001",
      nama: "Budi Santoso",
      createdAt: "2026-04-07T08:40:00.000Z",
      updatedAt: "2026-04-07T08:40:00.000Z",
    },
    {
      id: "pt-002",
      nomorRM: "RM-0002",
      nama: "Siti Aminah",
      createdAt: "2026-04-07T09:00:00.000Z",
      updatedAt: "2026-04-07T09:00:00.000Z",
    },
  ],
  prescriptions: [
    {
      id: "prx-001",
      nomorPeresepan: "RSP-2026-0001",
      nomorRM: "RM-0001",
      patientName: "Budi Santoso",
      doctorName: "dr. Umum RSI",
      status: "siap_proses",
      createdAt: "2026-04-07T08:42:00.000Z",
      updatedAt: "2026-04-07T08:42:00.000Z",
      items: [
        {
          id: "pri-001",
          nomorObat: "EFR-03415",
          medicineName: "Paracetamol 500mg",
          dosis: "3x1 sesudah makan",
          qty: 15,
        },
      ],
    },
    {
      id: "prx-002",
      nomorPeresepan: "RSP-2026-0002",
      nomorRM: "RM-0002",
      patientName: "Siti Aminah",
      doctorName: "dr. Jantung RSI",
      status: "siap_proses",
      createdAt: "2026-04-07T09:05:00.000Z",
      updatedAt: "2026-04-07T09:05:00.000Z",
      items: [
        {
          id: "pri-002",
          nomorObat: "EFR-00155",
          medicineName: "Amlodipine 10mg",
          dosis: "1x1 pagi",
          qty: 30,
        },
      ],
    },
  ],
  cashierPayments: [
    {
      id: "pay-001",
      nomorPeresepan: "RSP-2026-0001",
      statusBayar: "lunas",
      totalTagihan: 75000,
      totalDibayar: 75000,
      metodeBayar: "cash",
      paidAt: "2026-04-07T08:44:00.000Z",
      updatedAt: "2026-04-07T08:44:00.000Z",
    },
    {
      id: "pay-002",
      nomorPeresepan: "RSP-2026-0002",
      statusBayar: "lunas",
      totalTagihan: 120000,
      totalDibayar: 120000,
      metodeBayar: "debit",
      paidAt: "2026-04-07T09:08:00.000Z",
      updatedAt: "2026-04-07T09:08:00.000Z",
    },
  ],
  medicineTransactions: [
    {
      id: "txn-001",
      nomorObat: "EFR-03415",
      movementType: "keluar",
      quantity: 15,
      beforeQty: 135,
      afterQty: 120,
      referenceType: "dispensing",
      referenceId: "dsp-001",
      note: "Dispensing selesai untuk RSP-2026-0001",
      occurredAt: "2026-04-07T08:45:00.000Z",
    },
    {
      id: "txn-002",
      nomorObat: "EFR-00155",
      movementType: "keluar",
      quantity: 30,
      beforeQty: 94,
      afterQty: 64,
      referenceType: "dispensing",
      referenceId: "dsp-002",
      note: "Dispensing diproses untuk RSP-2026-0002",
      occurredAt: "2026-04-07T09:10:00.000Z",
    },
  ],
};

function cloneInitialStore(): DemoWorkflowStore {
  return JSON.parse(JSON.stringify(INITIAL_STORE)) as DemoWorkflowStore;
}

function toStableCode(value: string): number {
  let acc = 0;
  for (let i = 0; i < value.length; i += 1) {
    acc = (acc + value.charCodeAt(i) * (i + 17)) % 100000;
  }
  return acc;
}

function normalizeMedicineNumber(raw: unknown, fallbackId: string, fallbackIndex: number): string {
  if (typeof raw === "string") {
    const trimmed = raw.trim().toUpperCase();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  const idSuffix = fallbackId.replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase();
  const indexSuffix = String(fallbackIndex).padStart(4, "0");
  return `OBT-${idSuffix || indexSuffix}`;
}

function normalizeMedicalRecordNumber(raw: unknown, patientName: string): string {
  if (typeof raw === "string") {
    const trimmed = raw.trim().toUpperCase();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  const stableCode = String(toStableCode(patientName)).padStart(5, "0");
  return `RM-${stableCode}`;
}

function normalizePrescriptionNumber(raw: unknown, fallbackId: string, createdAt: string): string {
  if (typeof raw === "string") {
    const trimmed = raw.trim().toUpperCase();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  const datePrefix = createdAt.slice(0, 10).replace(/-/g, "");
  const idSuffix = fallbackId.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase();
  return `RSP-${datePrefix}-${idSuffix || "000000"}`;
}

function normalizePaymentStatus(raw: unknown, fallback: DemoPaymentStatus): DemoPaymentStatus {
  if (
    raw === "menunggu_bayar" ||
    raw === "lunas" ||
    raw === "gagal" ||
    raw === "dibatalkan" ||
    raw === "refund"
  ) {
    return raw;
  }

  return fallback;
}

function normalizePaymentMethod(
  raw: unknown,
  fallback: DemoPaymentMethod = "cash",
): DemoPaymentMethod {
  if (
    raw === "cash" ||
    raw === "debit" ||
    raw === "credit" ||
    raw === "bpjs" ||
    raw === "lainnya"
  ) {
    return raw;
  }

  return fallback;
}

function normalizeOptionalUserId(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function estimatePrescriptionTotalTagihan(prescription: DemoPrescriptionRecord): number {
  const total = prescription.items.reduce(
    (accumulator, item) => accumulator + Math.max(1, Math.round(item.qty)) * 5000,
    0,
  );

  return Math.max(0, total);
}

function buildPatientPaymentSummary(
  payment: DemoCashierPayment,
  prescription: DemoPrescriptionRecord,
  dispensing: DemoPatientDispensingProgress[] = [],
): DemoPatientPaymentSummary {
  const totalTagihan = Math.max(0, Math.round(payment.totalTagihan));
  const totalDibayar = Math.max(0, Math.round(payment.totalDibayar));

  return {
    id: payment.id,
    nomorPeresepan: prescription.nomorPeresepan,
    nomorRM: prescription.nomorRM,
    patientName: prescription.patientName,
    doctorName: prescription.doctorName,
    statusBayar: normalizePaymentStatus(payment.statusBayar, "menunggu_bayar"),
    totalTagihan,
    totalDibayar,
    sisaTagihan: Math.max(0, totalTagihan - totalDibayar),
    metodeBayar: payment.metodeBayar
      ? normalizePaymentMethod(payment.metodeBayar)
      : undefined,
    paidAt: payment.paidAt,
    updatedAt: payment.updatedAt,
    items: prescription.items,
    dispensing,
  };
}

function buildPatientDispensingProgress(order: DemoDispensingOrder): DemoPatientDispensingProgress {
  return {
    orderId: order.id,
    nomorObat: order.nomorObat,
    medicineName: order.medicineName,
    dosage: order.dosage,
    quantity: order.quantity,
    workflowStatus: resolveDispensingWorkflowStatus(order),
    updatedAt: order.updatedAt ?? order.createdAt,
  };
}

function buildDispensingProgressByPrescription(
  orders: DemoDispensingOrder[],
): Map<string, DemoPatientDispensingProgress[]> {
  const result = new Map<string, DemoPatientDispensingProgress[]>();

  for (const order of orders) {
    const nomorPeresepan = (order.nomorPeresepan ?? "").trim().toUpperCase();
    if (!nomorPeresepan) {
      continue;
    }

    const list = result.get(nomorPeresepan);
    const progress = buildPatientDispensingProgress(order);
    if (list) {
      list.push(progress);
    } else {
      result.set(nomorPeresepan, [progress]);
    }
  }

  for (const list of result.values()) {
    list.sort((first, second) => compareByDateDesc(first.updatedAt ?? "", second.updatedAt ?? ""));
  }

  return result;
}

function resolveDispensingEventTimestamp(order: DemoDispensingOrder): string {
  return order.updatedAt ?? order.createdAt;
}

function resolveDispensingEventTime(order: DemoDispensingOrder): number {
  const value = new Date(resolveDispensingEventTimestamp(order)).getTime();
  return Number.isFinite(value) ? value : 0;
}

function mapLatestDispensingOrderByMedicineNumber(
  orders: DemoDispensingOrder[],
): Map<string, DemoDispensingOrder> {
  const result = new Map<string, DemoDispensingOrder>();

  for (const order of orders) {
    const normalizedNomorObat = (order.nomorObat ?? "").trim().toUpperCase();
    if (!normalizedNomorObat) {
      continue;
    }

    const current = result.get(normalizedNomorObat);
    if (!current || resolveDispensingEventTime(order) > resolveDispensingEventTime(current)) {
      result.set(normalizedNomorObat, order);
    }
  }

  return result;
}

function findLatestDispensingOrderForPrescriptionItem(
  orders: DemoDispensingOrder[],
  nomorObat: string,
  medicineName: string,
): DemoDispensingOrder | undefined {
  const normalizedNomorObat = nomorObat.trim().toUpperCase();
  const normalizedMedicineName = normalizeComparisonText(medicineName);

  let latest: DemoDispensingOrder | undefined;

  for (const order of orders) {
    const orderNomorObat = (order.nomorObat ?? "").trim().toUpperCase();
    const sameNomorObat = normalizedNomorObat.length > 0 && orderNomorObat === normalizedNomorObat;
    const sameMedicineName =
      normalizedMedicineName.length > 0 &&
      normalizeComparisonText(order.medicineName) === normalizedMedicineName;

    if (!sameNomorObat && !sameMedicineName) {
      continue;
    }

    if (!latest || resolveDispensingEventTime(order) > resolveDispensingEventTime(latest)) {
      latest = order;
    }
  }

  return latest;
}

function inferPaymentStatusFromLegacyStatus(status: DemoDispensingOrder["status"]): DemoPaymentStatus {
  if (status === "diracik" || status === "siap_diserahkan" || status === "selesai") {
    return "lunas";
  }

  return "menunggu_bayar";
}

function inferWorkflowStatus(
  status: DemoDispensingOrder["status"],
  paymentStatus: DemoPaymentStatus,
): DemoDispensingWorkflowStatus {
  if (paymentStatus === "dibatalkan" || paymentStatus === "gagal" || paymentStatus === "refund") {
    return "cancel";
  }

  if (status === "selesai") {
    return "diserahkan";
  }

  if (status === "siap_diserahkan") {
    return "siap_diserahkan";
  }

  if (status === "diracik") {
    return "sedang_diracik";
  }

  return paymentStatus === "lunas" ? "siap_diracik" : "menunggu_pembayaran";
}

function resolveDispensingWorkflowStatus(order: DemoDispensingOrder): DemoDispensingWorkflowStatus {
  const paymentStatus = normalizePaymentStatus(
    order.paymentStatus,
    inferPaymentStatusFromLegacyStatus(order.status),
  );

  if (
    order.workflowStatus === "menunggu_validasi_resep" ||
    order.workflowStatus === "menunggu_pembayaran" ||
    order.workflowStatus === "siap_diracik" ||
    order.workflowStatus === "sedang_diracik" ||
    order.workflowStatus === "siap_diserahkan" ||
    order.workflowStatus === "diserahkan" ||
    order.workflowStatus === "cancel"
  ) {
    return order.workflowStatus;
  }

  return inferWorkflowStatus(order.status, paymentStatus);
}

function workflowStepFromStatus(status: DemoDispensingWorkflowStatus): number {
  if (status === "sedang_diracik") {
    return 1;
  }

  if (status === "siap_diserahkan") {
    return 2;
  }

  if (status === "diserahkan") {
    return 3;
  }

  return 0;
}

function workflowStepToTargetStatus(step: number): DispensingWorkflowTransitionStatus | null {
  if (step === 1) {
    return "sedang_diracik";
  }

  if (step === 2) {
    return "siap_diserahkan";
  }

  if (step === 3) {
    return "diserahkan";
  }

  return null;
}

function mapWorkflowStatusToDispensingStatus(
  workflowStatus: DispensingWorkflowTransitionStatus,
): DemoDispensingOrder["status"] {
  if (workflowStatus === "diserahkan") {
    return "selesai";
  }

  if (workflowStatus === "siap_diserahkan") {
    return "siap_diserahkan";
  }

  return "diracik";
}

function inferStockStatus(stock: number): DemoStockItem["status"] {
  if (stock <= 5) {
    return "kritis";
  }

  if (stock <= 20) {
    return "menipis";
  }

  return "aman";
}

function parseReminderChannel(value: unknown): DemoReminderChannel {
  if (value === "email" || value === "sms" || value === "whatsapp" || value === "telegram") {
    return value;
  }

  return "aplikasi";
}

function isIsoTimeString(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizeReminderTime(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_REMINDER_TIME;
  }

  const trimmed = value.trim();
  return isIsoTimeString(trimmed) ? trimmed : DEFAULT_REMINDER_TIME;
}

function normalizeStockItems(value: unknown): DemoStockItem[] {
  if (!Array.isArray(value)) {
    return cloneInitialStore().stockItems;
  }

  const items: DemoStockItem[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as Partial<DemoStockItem>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.nama !== "string" ||
      typeof candidate.stok !== "number" ||
      typeof candidate.satuan !== "string" ||
      typeof candidate.expiredAt !== "string" ||
      typeof candidate.lokasi !== "string"
    ) {
      continue;
    }

    const stock = Math.max(0, Math.round(candidate.stok));
    items.push({
      id: candidate.id,
      nomorObat: normalizeMedicineNumber(candidate.nomorObat, candidate.id, items.length + 1),
      nama: candidate.nama,
      stok: stock,
      satuan: candidate.satuan,
      expiredAt: candidate.expiredAt,
      lokasi: candidate.lokasi,
      status: inferStockStatus(stock),
    });
  }

  return items.length > 0 ? items : cloneInitialStore().stockItems;
}

function normalizeDispensingOrders(value: unknown): DemoDispensingOrder[] {
  if (!Array.isArray(value)) {
    return cloneInitialStore().dispensingOrders;
  }

  const allowedStatuses = new Set<DemoDispensingOrder["status"]>([
    "diterima",
    "diracik",
    "siap_diserahkan",
    "selesai",
  ]);

  const orders: DemoDispensingOrder[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as Partial<DemoDispensingOrder>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.patientName !== "string" ||
      typeof candidate.medicineName !== "string" ||
      typeof candidate.dosage !== "string" ||
      typeof candidate.quantity !== "number" ||
      typeof candidate.createdAt !== "string"
    ) {
      continue;
    }

    const status = allowedStatuses.has(candidate.status as DemoDispensingOrder["status"])
      ? (candidate.status as DemoDispensingOrder["status"])
      : "diterima";

    const paymentStatus = normalizePaymentStatus(
      candidate.paymentStatus,
      inferPaymentStatusFromLegacyStatus(status),
    );

    const createdAt = candidate.createdAt;
    const nomorRM = normalizeMedicalRecordNumber(candidate.nomorRM, candidate.patientName);
    const nomorPeresepan = normalizePrescriptionNumber(candidate.nomorPeresepan, candidate.id, createdAt);
    const quantity = Math.max(1, Math.round(candidate.quantity));

    orders.push({
      id: candidate.id,
      patientName: candidate.patientName,
      nomorRM,
      nomorPeresepan,
      nomorObat:
        typeof candidate.nomorObat === "string" && candidate.nomorObat.trim().length > 0
          ? candidate.nomorObat.trim().toUpperCase()
          : undefined,
      medicineName: candidate.medicineName,
      dosage: candidate.dosage,
      quantity,
      status,
      workflowStatus:
        candidate.workflowStatus &&
        typeof candidate.workflowStatus === "string" &&
        candidate.workflowStatus.length > 0
          ? candidate.workflowStatus
          : inferWorkflowStatus(status, paymentStatus),
      paymentStatus,
      cancelReason:
        typeof candidate.cancelReason === "string" && candidate.cancelReason.trim().length > 0
          ? candidate.cancelReason.trim()
          : undefined,
      updatedAt:
        typeof candidate.updatedAt === "string" && candidate.updatedAt.trim().length > 0
          ? candidate.updatedAt
          : createdAt,
      createdAt,
    });
  }

  return orders;
}

function normalizeReminders(value: unknown): DemoReminder[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const reminders: DemoReminder[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as Partial<DemoReminder>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.userId !== "string" ||
      typeof candidate.title !== "string" ||
      typeof candidate.date !== "string" ||
      typeof candidate.createdAt !== "string"
    ) {
      continue;
    }

    reminders.push({
      id: candidate.id,
      userId: candidate.userId,
      title: candidate.title,
      date: candidate.date,
      time: normalizeReminderTime(candidate.time),
      channel: parseReminderChannel(candidate.channel),
      note: typeof candidate.note === "string" ? candidate.note : "",
      createdAt: candidate.createdAt,
    });
  }

  return reminders;
}

function normalizePatients(value: unknown, orders: DemoDispensingOrder[]): DemoPatientRecord[] {
  const patients: DemoPatientRecord[] = [];
  const now = new Date().toISOString();
  const seenByRm = new Set<string>();

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const candidate = item as Partial<DemoPatientRecord>;
      if (typeof candidate.id !== "string" || typeof candidate.nama !== "string") {
        continue;
      }

      const nomorRM = normalizeMedicalRecordNumber(candidate.nomorRM, candidate.nama);
      if (seenByRm.has(nomorRM)) {
        continue;
      }

      seenByRm.add(nomorRM);
      patients.push({
        id: candidate.id,
        userId: typeof candidate.userId === "string" ? candidate.userId : undefined,
        nomorRM,
        nama: candidate.nama,
        createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : now,
        updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : now,
      });
    }
  }

  for (const order of orders) {
    const nomorRM = normalizeMedicalRecordNumber(order.nomorRM, order.patientName);
    if (seenByRm.has(nomorRM)) {
      continue;
    }

    seenByRm.add(nomorRM);
    patients.push({
      id: `pt-${randomUUID().slice(0, 8)}`,
      nomorRM,
      nama: order.patientName,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt ?? order.createdAt,
    });
  }

  return patients;
}

function normalizePrescriptions(
  value: unknown,
  orders: DemoDispensingOrder[],
): DemoPrescriptionRecord[] {
  const prescriptions: DemoPrescriptionRecord[] = [];
  const seenPrescription = new Set<string>();

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const candidate = item as Partial<DemoPrescriptionRecord>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.patientName !== "string" ||
        typeof candidate.doctorName !== "string" ||
        typeof candidate.createdAt !== "string"
      ) {
        continue;
      }

      const nomorPeresepan = normalizePrescriptionNumber(
        candidate.nomorPeresepan,
        candidate.id,
        candidate.createdAt,
      );
      if (seenPrescription.has(nomorPeresepan)) {
        continue;
      }

      const nomorRM = normalizeMedicalRecordNumber(candidate.nomorRM, candidate.patientName);
      const status =
        candidate.status === "dibuat" ||
        candidate.status === "tervalidasi_apotek" ||
        candidate.status === "siap_proses" ||
        candidate.status === "selesai" ||
        candidate.status === "batal"
          ? candidate.status
          : "dibuat";

      const items = Array.isArray(candidate.items)
        ? candidate.items
            .map((rawItem, index) => {
              if (!rawItem || typeof rawItem !== "object") {
                return null;
              }

              const castItem = rawItem as {
                id?: unknown;
                nomorObat?: unknown;
                medicineName?: unknown;
                dosis?: unknown;
                qty?: unknown;
              };

              if (typeof castItem.medicineName !== "string" || typeof castItem.dosis !== "string") {
                return null;
              }

              const qtyRaw =
                typeof castItem.qty === "number"
                  ? castItem.qty
                  : typeof castItem.qty === "string"
                    ? Number.parseInt(castItem.qty, 10)
                    : 0;

              return {
                id:
                  typeof castItem.id === "string" && castItem.id.trim().length > 0
                    ? castItem.id
                    : `pri-${randomUUID().slice(0, 8)}`,
                nomorObat: normalizeMedicineNumber(
                  castItem.nomorObat,
                  `${candidate.id}-${index + 1}`,
                  index + 1,
                ),
                medicineName: castItem.medicineName,
                dosis: castItem.dosis,
                qty: Math.max(1, Number.isFinite(qtyRaw) ? Math.round(qtyRaw) : 1),
              };
            })
            .filter((parsed): parsed is DemoPrescriptionRecord["items"][number] => Boolean(parsed))
        : [];

      seenPrescription.add(nomorPeresepan);
      prescriptions.push({
        id: candidate.id,
        nomorPeresepan,
        nomorRM,
        patientName: candidate.patientName,
        doctorName: candidate.doctorName,
        status,
        createdAt: candidate.createdAt,
        updatedAt:
          typeof candidate.updatedAt === "string" && candidate.updatedAt.trim().length > 0
            ? candidate.updatedAt
            : candidate.createdAt,
        items,
      });
    }
  }

  for (const order of orders) {
    const nomorPeresepan = normalizePrescriptionNumber(
      order.nomorPeresepan,
      order.id,
      order.createdAt,
    );
    if (seenPrescription.has(nomorPeresepan)) {
      continue;
    }

    seenPrescription.add(nomorPeresepan);
    prescriptions.push({
      id: `prx-${randomUUID().slice(0, 8)}`,
      nomorPeresepan,
      nomorRM: normalizeMedicalRecordNumber(order.nomorRM, order.patientName),
      patientName: order.patientName,
      doctorName: "dr. Integrasi RSI",
      status: "dibuat",
      createdAt: order.createdAt,
      updatedAt: order.updatedAt ?? order.createdAt,
      items: [
        {
          id: `pri-${randomUUID().slice(0, 8)}`,
          nomorObat: normalizeMedicineNumber(order.nomorObat, order.id, 1),
          medicineName: order.medicineName,
          dosis: order.dosage,
          qty: order.quantity,
        },
      ],
    });
  }

  return prescriptions;
}

function normalizeCashierPayments(
  value: unknown,
  orders: DemoDispensingOrder[],
): DemoCashierPayment[] {
  const payments: DemoCashierPayment[] = [];
  const seenPrescription = new Set<string>();

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const candidate = item as Partial<DemoCashierPayment>;
      if (typeof candidate.id !== "string" || typeof candidate.updatedAt !== "string") {
        continue;
      }

      const normalizedPrescription = normalizePrescriptionNumber(
        candidate.nomorPeresepan,
        candidate.id,
        candidate.updatedAt,
      );
      if (seenPrescription.has(normalizedPrescription)) {
        continue;
      }

      const totalTagihan =
        typeof candidate.totalTagihan === "number" && Number.isFinite(candidate.totalTagihan)
          ? candidate.totalTagihan
          : 0;
      const totalDibayar =
        typeof candidate.totalDibayar === "number" && Number.isFinite(candidate.totalDibayar)
          ? candidate.totalDibayar
          : 0;

      const statusBayar = normalizePaymentStatus(candidate.statusBayar, "menunggu_bayar");

      seenPrescription.add(normalizedPrescription);
      payments.push({
        id: candidate.id,
        nomorPeresepan: normalizedPrescription,
        statusBayar,
        totalTagihan,
        totalDibayar,
        metodeBayar:
          candidate.metodeBayar === "cash" ||
          candidate.metodeBayar === "debit" ||
          candidate.metodeBayar === "credit" ||
          candidate.metodeBayar === "bpjs" ||
          candidate.metodeBayar === "lainnya"
            ? candidate.metodeBayar
            : undefined,
        paidAt:
          typeof candidate.paidAt === "string" && candidate.paidAt.trim().length > 0
            ? candidate.paidAt
            : undefined,
        updatedAt: candidate.updatedAt,
      });
    }
  }

  for (const order of orders) {
    const nomorPeresepan = normalizePrescriptionNumber(
      order.nomorPeresepan,
      order.id,
      order.createdAt,
    );
    if (seenPrescription.has(nomorPeresepan)) {
      continue;
    }

    const statusBayar = normalizePaymentStatus(
      order.paymentStatus,
      inferPaymentStatusFromLegacyStatus(order.status),
    );
    const totalTagihan = Math.max(0, order.quantity * 5000);
    const totalDibayar = statusBayar === "lunas" ? totalTagihan : 0;

    seenPrescription.add(nomorPeresepan);
    payments.push({
      id: `pay-${randomUUID().slice(0, 8)}`,
      nomorPeresepan,
      statusBayar,
      totalTagihan,
      totalDibayar,
      metodeBayar: statusBayar === "lunas" ? "cash" : undefined,
      paidAt: statusBayar === "lunas" ? order.updatedAt ?? order.createdAt : undefined,
      updatedAt: order.updatedAt ?? order.createdAt,
    });
  }

  return payments;
}

function normalizeMedicineTransactions(value: unknown): DemoMedicineTransaction[] {
  if (!Array.isArray(value)) {
    return [...cloneInitialStore().medicineTransactions].sort((a, b) =>
      compareByDateDesc(a.occurredAt, b.occurredAt),
    );
  }

  const transactions: DemoMedicineTransaction[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as Partial<DemoMedicineTransaction>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.occurredAt !== "string" ||
      typeof candidate.quantity !== "number" ||
      typeof candidate.beforeQty !== "number" ||
      typeof candidate.afterQty !== "number"
    ) {
      continue;
    }

    const movementType =
      candidate.movementType === "masuk" ||
      candidate.movementType === "keluar" ||
      candidate.movementType === "adjustment" ||
      candidate.movementType === "kadaluarsa" ||
      candidate.movementType === "retur"
        ? candidate.movementType
        : "adjustment";

    const referenceType =
      candidate.referenceType === "dispensing" ||
      candidate.referenceType === "stock-opname" ||
      candidate.referenceType === "manual"
        ? candidate.referenceType
        : "manual";

    transactions.push({
      id: candidate.id,
      nomorObat: normalizeMedicineNumber(candidate.nomorObat, candidate.id, transactions.length + 1),
      movementType,
      quantity: Math.max(1, Math.round(candidate.quantity)),
      beforeQty: Math.max(0, Math.round(candidate.beforeQty)),
      afterQty: Math.max(0, Math.round(candidate.afterQty)),
      referenceType,
      referenceId:
        typeof candidate.referenceId === "string" && candidate.referenceId.trim().length > 0
          ? candidate.referenceId
          : undefined,
      actorUserId:
        typeof candidate.actorUserId === "string" && candidate.actorUserId.trim().length > 0
          ? candidate.actorUserId
          : undefined,
      note: typeof candidate.note === "string" ? candidate.note : undefined,
      occurredAt: candidate.occurredAt,
    });
  }

  return transactions.sort((a, b) => compareByDateDesc(a.occurredAt, b.occurredAt));
}

function toNullableString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function readLegacyStoreCandidate(): Promise<DemoWorkflowStore> {
  try {
    const content = await readFile(LEGACY_STORE_FILE, "utf-8");
    const parsed = JSON.parse(content) as Partial<DemoWorkflowStore>;

    const stockItems = normalizeStockItems(parsed.stockItems);
    const dispensingOrders = normalizeDispensingOrders(parsed.dispensingOrders);
    const reminders = normalizeReminders(parsed.reminders);
    const patients = normalizePatients(parsed.patients, dispensingOrders);
    const prescriptions = normalizePrescriptions(parsed.prescriptions, dispensingOrders);
    const cashierPayments = normalizeCashierPayments(parsed.cashierPayments, dispensingOrders);
    const medicineTransactions = normalizeMedicineTransactions(parsed.medicineTransactions);

    return {
      stockItems,
      dispensingOrders,
      reminders,
      patients,
      prescriptions,
      cashierPayments,
      medicineTransactions,
    };
  } catch {
    return cloneInitialStore();
  }
}

async function readStoreFromSqlite(): Promise<DemoWorkflowStore> {
  const db = await getDemoDb();

  const [
    stockRows,
    dispensingRows,
    reminderRows,
    patientRows,
    prescriptionRows,
    prescriptionItemRows,
    paymentRows,
    transactionRows,
  ] = await Promise.all([
    db.select().from(demoStockItemsTable),
    db.select().from(demoDispensingOrdersTable),
    db.select().from(demoRemindersTable),
    db.select().from(demoPatientsTable),
    db.select().from(demoPrescriptionsTable),
    db.select().from(demoPrescriptionItemsTable),
    db.select().from(demoCashierPaymentsTable),
    db.select().from(demoMedicineTransactionsTable),
  ]);

  const itemsByPrescriptionId = new Map<string, DemoPrescriptionRecord["items"]>();
  for (const item of prescriptionItemRows) {
    const bucket = itemsByPrescriptionId.get(item.prescriptionId) ?? [];
    bucket.push({
      id: item.id,
      nomorObat: item.nomorObat,
      medicineName: item.medicineName,
      dosis: item.dosis,
      qty: item.qty,
    });
    itemsByPrescriptionId.set(item.prescriptionId, bucket);
  }

  const stockItems = normalizeStockItems(stockRows);
  const dispensingOrders = normalizeDispensingOrders(dispensingRows);
  const reminders = normalizeReminders(reminderRows);
  const patients = normalizePatients(patientRows, dispensingOrders);
  const prescriptions = normalizePrescriptions(
    prescriptionRows.map((row) => ({
      ...row,
      items: itemsByPrescriptionId.get(row.id) ?? [],
    })),
    dispensingOrders,
  );
  const cashierPayments = normalizeCashierPayments(paymentRows, dispensingOrders);
  const medicineTransactions = normalizeMedicineTransactions(transactionRows);

  return {
    stockItems,
    dispensingOrders,
    reminders,
    patients,
    prescriptions,
    cashierPayments,
    medicineTransactions,
  };
}

async function readStoreFromDatabase(): Promise<DemoWorkflowStore> {
  if (!isDispensingPostgresActive()) {
    return readStoreFromSqlite();
  }

  const sqliteStore = await readStoreFromSqlite();

  await migrateDispensingFromSqliteIfNeeded({
    dispensingOrders: sqliteStore.dispensingOrders,
    prescriptions: sqliteStore.prescriptions,
    patients: sqliteStore.patients,
    cashierPayments: sqliteStore.cashierPayments,
  });

  const pgSnapshot = await readDispensingPgSnapshot();
  const dispensingOrders = normalizeDispensingOrders(pgSnapshot.dispensingOrders);
  const patients = normalizePatients(pgSnapshot.patients, dispensingOrders);
  const prescriptions = normalizePrescriptions(
    pgSnapshot.prescriptions,
    dispensingOrders,
  );
  const cashierPayments = normalizeCashierPayments(
    pgSnapshot.cashierPayments,
    dispensingOrders,
  );

  return {
    stockItems: sqliteStore.stockItems,
    dispensingOrders,
    reminders: sqliteStore.reminders,
    patients,
    prescriptions,
    cashierPayments,
    medicineTransactions: sqliteStore.medicineTransactions,
  };
}

async function persistOperationalStoreToSqlite(store: DemoWorkflowStore): Promise<void> {
  const db = await getDemoDb();

  const stockItems = normalizeStockItems(store.stockItems);
  const reminders = normalizeReminders(store.reminders);
  const medicineTransactions = normalizeMedicineTransactions(store.medicineTransactions);

  await db.transaction(async (tx) => {
    await tx.delete(demoMedicineTransactionsTable);
    await tx.delete(demoRemindersTable);
    await tx.delete(demoStockItemsTable);

    if (stockItems.length > 0) {
      await tx.insert(demoStockItemsTable).values(
        stockItems.map((item, index) => ({
          id: item.id,
          nomorObat: normalizeMedicineNumber(item.nomorObat, item.id, index + 1),
          nama: item.nama,
          stok: Math.max(0, Math.round(item.stok)),
          satuan: item.satuan,
          expiredAt: item.expiredAt,
          lokasi: item.lokasi,
          status: inferStockStatus(item.stok),
        })),
      );
    }

    if (medicineTransactions.length > 0) {
      await tx.insert(demoMedicineTransactionsTable).values(
        medicineTransactions.map((item, index) => ({
          id: item.id,
          nomorObat: normalizeMedicineNumber(item.nomorObat, item.id, index + 1),
          movementType: item.movementType,
          quantity: Math.max(1, Math.round(item.quantity)),
          beforeQty: Math.max(0, Math.round(item.beforeQty)),
          afterQty: Math.max(0, Math.round(item.afterQty)),
          referenceType: item.referenceType,
          referenceId: toNullableString(item.referenceId),
          actorUserId: toNullableString(item.actorUserId),
          note: toNullableString(item.note),
          occurredAt: item.occurredAt,
        })),
      );
    }

    if (reminders.length > 0) {
      await tx.insert(demoRemindersTable).values(
        reminders.map((item) => ({
          id: item.id,
          userId: item.userId,
          title: item.title,
          date: item.date,
          time: normalizeReminderTime(item.time),
          channel: parseReminderChannel(item.channel),
          note: item.note,
          createdAt: item.createdAt,
        })),
      );
    }
  });
}

async function persistDispensingStoreToPostgres(store: DemoWorkflowStore): Promise<void> {
  const dispensingOrders = normalizeDispensingOrders(store.dispensingOrders);
  const patients = normalizePatients(store.patients, dispensingOrders);
  const prescriptions = normalizePrescriptions(store.prescriptions, dispensingOrders);
  const cashierPayments = normalizeCashierPayments(
    store.cashierPayments,
    dispensingOrders,
  );

  await persistDispensingPgSnapshot({
    dispensingOrders,
    prescriptions,
    patients,
    cashierPayments,
  });
}

async function persistStoreToDatabase(store: DemoWorkflowStore): Promise<void> {
  if (isDispensingPostgresActive()) {
    await persistDispensingStoreToPostgres(store);
    await persistOperationalStoreToSqlite(store);
    return;
  }

  const db = await getDemoDb();

  const stockItems = normalizeStockItems(store.stockItems);
  const dispensingOrders = normalizeDispensingOrders(store.dispensingOrders);
  const reminders = normalizeReminders(store.reminders);
  const patients = normalizePatients(store.patients, dispensingOrders);
  const prescriptions = normalizePrescriptions(store.prescriptions, dispensingOrders);
  const cashierPayments = normalizeCashierPayments(store.cashierPayments, dispensingOrders);
  const medicineTransactions = normalizeMedicineTransactions(store.medicineTransactions);

  await db.transaction(async (tx) => {
    await tx.delete(demoPrescriptionItemsTable);
    await tx.delete(demoMedicineTransactionsTable);
    await tx.delete(demoCashierPaymentsTable);
    await tx.delete(demoDispensingOrdersTable);
    await tx.delete(demoPrescriptionsTable);
    await tx.delete(demoPatientsTable);
    await tx.delete(demoRemindersTable);
    await tx.delete(demoStockItemsTable);

    if (stockItems.length > 0) {
      await tx.insert(demoStockItemsTable).values(
        stockItems.map((item, index) => ({
          id: item.id,
          nomorObat: normalizeMedicineNumber(item.nomorObat, item.id, index + 1),
          nama: item.nama,
          stok: Math.max(0, Math.round(item.stok)),
          satuan: item.satuan,
          expiredAt: item.expiredAt,
          lokasi: item.lokasi,
          status: inferStockStatus(item.stok),
        })),
      );
    }

    if (dispensingOrders.length > 0) {
      await tx.insert(demoDispensingOrdersTable).values(
        dispensingOrders.map((item, index) => {
          const paymentStatus = normalizePaymentStatus(
            item.paymentStatus,
            inferPaymentStatusFromLegacyStatus(item.status),
          );

          return {
            id: item.id,
            patientName: item.patientName,
            nomorRM: toNullableString(item.nomorRM),
            nomorPeresepan: toNullableString(item.nomorPeresepan),
            nomorObat: normalizeMedicineNumber(item.nomorObat, item.id, index + 1),
            medicineName: item.medicineName,
            dosage: item.dosage,
            quantity: Math.max(1, Math.round(item.quantity)),
            status: item.status,
            workflowStatus:
              item.workflowStatus ?? inferWorkflowStatus(item.status, paymentStatus),
            paymentStatus,
            cancelReason: toNullableString(item.cancelReason),
            updatedAt: toNullableString(item.updatedAt ?? item.createdAt),
            createdAt: item.createdAt,
          };
        }),
      );
    }

    if (patients.length > 0) {
      await tx.insert(demoPatientsTable).values(
        patients.map((item) => ({
          id: item.id,
          userId: toNullableString(item.userId),
          nomorRM: item.nomorRM,
          nama: item.nama,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
      );
    }

    if (prescriptions.length > 0) {
      await tx.insert(demoPrescriptionsTable).values(
        prescriptions.map((item) => ({
          id: item.id,
          nomorPeresepan: item.nomorPeresepan,
          nomorRM: item.nomorRM,
          patientName: item.patientName,
          doctorName: item.doctorName,
          status: item.status,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
      );
    }

    const prescriptionItems = prescriptions.flatMap((prescription) =>
      prescription.items.map((item, index) => ({
        id: item.id,
        prescriptionId: prescription.id,
        nomorObat: normalizeMedicineNumber(item.nomorObat, `${prescription.id}-${item.id}`, index + 1),
        medicineName: item.medicineName,
        dosis: item.dosis,
        qty: Math.max(1, Math.round(item.qty)),
      })),
    );

    if (prescriptionItems.length > 0) {
      await tx.insert(demoPrescriptionItemsTable).values(prescriptionItems);
    }

    if (cashierPayments.length > 0) {
      await tx.insert(demoCashierPaymentsTable).values(
        cashierPayments.map((item) => ({
          id: item.id,
          nomorPeresepan: item.nomorPeresepan,
          statusBayar: normalizePaymentStatus(item.statusBayar, "menunggu_bayar"),
          totalTagihan: Math.max(0, Math.round(item.totalTagihan)),
          totalDibayar: Math.max(0, Math.round(item.totalDibayar)),
          metodeBayar: toNullableString(item.metodeBayar),
          paidAt: toNullableString(item.paidAt),
          updatedAt: item.updatedAt,
        })),
      );
    }

    if (medicineTransactions.length > 0) {
      await tx.insert(demoMedicineTransactionsTable).values(
        medicineTransactions.map((item, index) => ({
          id: item.id,
          nomorObat: normalizeMedicineNumber(item.nomorObat, item.id, index + 1),
          movementType: item.movementType,
          quantity: Math.max(1, Math.round(item.quantity)),
          beforeQty: Math.max(0, Math.round(item.beforeQty)),
          afterQty: Math.max(0, Math.round(item.afterQty)),
          referenceType: item.referenceType,
          referenceId: toNullableString(item.referenceId),
          actorUserId: toNullableString(item.actorUserId),
          note: toNullableString(item.note),
          occurredAt: item.occurredAt,
        })),
      );
    }

    if (reminders.length > 0) {
      await tx.insert(demoRemindersTable).values(
        reminders.map((item) => ({
          id: item.id,
          userId: item.userId,
          title: item.title,
          date: item.date,
          time: normalizeReminderTime(item.time),
          channel: parseReminderChannel(item.channel),
          note: item.note,
          createdAt: item.createdAt,
        })),
      );
    }
  });
}

async function ensureStoreMigration(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      const marker = await readDemoMetaValue(DEMO_STORE_MIGRATION_META_KEY);
      if (marker === DEMO_STORE_MIGRATION_VALUE) {
        return;
      }

      const db = await getDemoDb();
      const [existingStockRow] = await db.select({ id: demoStockItemsTable.id }).from(demoStockItemsTable).limit(1);

      if (!existingStockRow) {
        const legacyStore = await readLegacyStoreCandidate();
        await persistStoreToDatabase(legacyStore);
      }

      const currentStore = await readStoreFromDatabase();
      if (isApotekerAutoStoreCleanupEnabled()) {
        const cleanupResult = await applyCatalogOnlyCleanup(currentStore);
        if (cleanupResult.changed) {
          await persistStoreToDatabase(cleanupResult.store);
        }
      }

      await writeDemoMetaValue(DEMO_STORE_MIGRATION_META_KEY, DEMO_STORE_MIGRATION_VALUE);
    })();
  }

  await migrationPromise;
}

async function readStore(): Promise<DemoWorkflowStore> {
  await ensureStoreMigration();
  return readStoreFromDatabase();
}

async function writeStore(store: DemoWorkflowStore): Promise<void> {
  await ensureStoreMigration();
  await persistStoreToDatabase(store);
}

async function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const previousWrite = writeQueue;
  let releaseCurrentWrite!: () => void;

  writeQueue = new Promise<void>((resolve) => {
    releaseCurrentWrite = resolve;
  });

  await previousWrite;

  try {
    return await operation();
  } finally {
    releaseCurrentWrite();
  }
}

function compareByDateDesc(first: string, second: string): number {
  return new Date(second).getTime() - new Date(first).getTime();
}

function normalizeComparisonText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeSearchText(value: string): string {
  return normalizeComparisonText(value).replace(/[^a-z0-9]/g, "");
}

function normalizeMedicineNumberSearchText(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeMedicalRecordSearchText(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isLikelyMedicineNumberQuery(value: string): boolean {
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) {
    return false;
  }

  const normalized = normalizeMedicineNumberSearchText(value);
  const numericOnlyPattern = /^\d{3,}$/;
  if (numericOnlyPattern.test(normalized)) {
    return true;
  }

  const compactCodePattern = /^[A-Z]{2,6}\d{2,}[A-Z0-9]*$/;
  if (compactCodePattern.test(normalized) && !trimmed.includes(" ")) {
    return true;
  }

  const spacedCodePattern = /^[A-Z]{2,6}\s*[-/]?\s*\d{2,}[A-Z0-9]*$/;
  return spacedCodePattern.test(trimmed);
}

function collapseRepeatedCharacters(value: string): string {
  return value.replace(/(.)\1+/g, "$1");
}

function matchesMedicineSearchQuery(
  query: string,
  candidateFields: Array<string | undefined>,
): boolean {
  const normalizedQuery = normalizeComparisonText(query);
  if (!normalizedQuery) {
    return true;
  }

  const compactQuery = normalizeSearchText(query);
  const compactCollapsedQuery = collapseRepeatedCharacters(compactQuery);

  for (const rawField of candidateFields) {
    const field = rawField ?? "";
    const normalizedField = normalizeComparisonText(field);
    if (!normalizedField) {
      continue;
    }

    if (
      normalizedField.includes(normalizedQuery) ||
      normalizedQuery.includes(normalizedField)
    ) {
      return true;
    }

    const compactField = normalizeSearchText(field);
    if (!compactField) {
      continue;
    }

    if (
      compactField.includes(compactQuery) ||
      compactQuery.includes(compactField)
    ) {
      return true;
    }

    const compactCollapsedField = collapseRepeatedCharacters(compactField);
    if (
      compactCollapsedField.includes(compactCollapsedQuery) ||
      compactCollapsedQuery.includes(compactCollapsedField)
    ) {
      return true;
    }
  }

  return false;
}

function matchesByComparisonText(first: string, second: string): boolean {
  const normalizedFirst = normalizeComparisonText(first);
  const normalizedSecond = normalizeComparisonText(second);

  if (!normalizedFirst || !normalizedSecond) {
    return false;
  }

  return (
    normalizedFirst === normalizedSecond ||
    normalizedFirst.includes(normalizedSecond) ||
    normalizedSecond.includes(normalizedFirst)
  );
}

interface CatalogMedicineLookupEntry {
  nomorObat: string;
  normalizedName: string;
}

function normalizeMedicineNameForCatalogLookup(value: string): string {
  return normalizeComparisonText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCatalogMedicineLookup(catalogItems: DemoStockItem[]): CatalogMedicineLookupEntry[] {
  const lookup: CatalogMedicineLookupEntry[] = [];
  const seenNames = new Set<string>();

  for (const item of catalogItems) {
    const nomorObat = (item.nomorObat ?? "").trim().toUpperCase();
    const normalizedName = normalizeMedicineNameForCatalogLookup(item.nama);
    if (!nomorObat || !normalizedName || seenNames.has(normalizedName)) {
      continue;
    }

    seenNames.add(normalizedName);
    lookup.push({
      nomorObat,
      normalizedName,
    });
  }

  return lookup;
}

function findCatalogNomorObatByMedicineName(
  lookup: CatalogMedicineLookupEntry[],
  medicineName: string,
): string | undefined {
  const normalizedName = normalizeMedicineNameForCatalogLookup(medicineName);
  if (!normalizedName) {
    return undefined;
  }

  const exact = lookup.find((item) => item.normalizedName === normalizedName);
  if (exact) {
    return exact.nomorObat;
  }

  const partial = lookup.find(
    (item) =>
      item.normalizedName.includes(normalizedName) ||
      normalizedName.includes(item.normalizedName),
  );

  return partial?.nomorObat;
}

function isCatalogMedicineNumber(value: string): boolean {
  return /^KRN-\d{4}$/.test(value) || /^EFR-\d{5}$/.test(value);
}

function shouldTryCatalogRemap(value: string): boolean {
  return value.length === 0 || value.startsWith("OBT-");
}

function resolveCatalogMedicineNumber(
  inputNomorObat: string | undefined,
  medicineName: string,
  lookup: CatalogMedicineLookupEntry[],
): string | undefined {
  const normalizedInput = (inputNomorObat ?? "").trim().toUpperCase();
  if (normalizedInput && isCatalogMedicineNumber(normalizedInput)) {
    return normalizedInput;
  }

  if (!shouldTryCatalogRemap(normalizedInput)) {
    return normalizedInput || undefined;
  }

  return findCatalogNomorObatByMedicineName(lookup, medicineName);
}

async function applyCatalogOnlyCleanup(store: DemoWorkflowStore): Promise<{
  store: DemoWorkflowStore;
  changed: boolean;
}> {
  const catalogItems = await loadExternalCatalogItems();
  const catalogLookup = buildCatalogMedicineLookup(catalogItems);

  const nextStore: DemoWorkflowStore = {
    stockItems: [],
    dispensingOrders: store.dispensingOrders.map((item) => ({ ...item })),
    reminders: [...store.reminders],
    patients: [...store.patients],
    prescriptions: store.prescriptions.map((item) => ({
      ...item,
      items: item.items.map((prescriptionItem) => ({ ...prescriptionItem })),
    })),
    cashierPayments: [...store.cashierPayments],
    medicineTransactions: store.medicineTransactions.map((item) => ({ ...item })),
  };

  let changed = store.stockItems.length > 0;
  const nomorObatRemap = new Map<string, string>();

  for (const order of nextStore.dispensingOrders) {
    const previousNomorObat = (order.nomorObat ?? "").trim().toUpperCase();
    const nextNomorObat = resolveCatalogMedicineNumber(
      order.nomorObat,
      order.medicineName,
      catalogLookup,
    );

    if (nextNomorObat && nextNomorObat !== previousNomorObat) {
      order.nomorObat = nextNomorObat;
      changed = true;
    }

    if (previousNomorObat && nextNomorObat && previousNomorObat !== nextNomorObat) {
      nomorObatRemap.set(previousNomorObat, nextNomorObat);
    }
  }

  for (const prescription of nextStore.prescriptions) {
    for (const item of prescription.items) {
      const previousNomorObat = item.nomorObat.trim().toUpperCase();
      const nextNomorObat = resolveCatalogMedicineNumber(
        item.nomorObat,
        item.medicineName,
        catalogLookup,
      );

      if (nextNomorObat && nextNomorObat !== previousNomorObat) {
        item.nomorObat = nextNomorObat;
        changed = true;
      }

      if (previousNomorObat && nextNomorObat && previousNomorObat !== nextNomorObat) {
        nomorObatRemap.set(previousNomorObat, nextNomorObat);
      }
    }
  }

  const nomorObatByOrderId = new Map<string, string>();
  for (const order of nextStore.dispensingOrders) {
    const normalizedNomorObat = (order.nomorObat ?? "").trim().toUpperCase();
    if (!normalizedNomorObat) {
      continue;
    }

    nomorObatByOrderId.set(order.id, normalizedNomorObat);
  }

  for (const transaction of nextStore.medicineTransactions) {
    const previousNomorObat = transaction.nomorObat.trim().toUpperCase();
    if (!previousNomorObat) {
      continue;
    }

    const mappedFromRemap = nomorObatRemap.get(previousNomorObat);
    if (mappedFromRemap && mappedFromRemap !== previousNomorObat) {
      transaction.nomorObat = mappedFromRemap;
      changed = true;
      continue;
    }

    if (
      transaction.referenceType === "dispensing" &&
      typeof transaction.referenceId === "string" &&
      transaction.referenceId.trim().length > 0
    ) {
      const mappedFromOrder = nomorObatByOrderId.get(transaction.referenceId.trim());
      if (mappedFromOrder && mappedFromOrder !== previousNomorObat) {
        transaction.nomorObat = mappedFromOrder;
        changed = true;
      }
    }
  }

  return {
    store: nextStore,
    changed,
  };
}

function resolveCatalogDataPaths(fileName: string): string[] {
  return [
    path.join(process.cwd(), "data", fileName),
    path.join(process.cwd(), "..", "data", fileName),
  ];
}

async function readCatalogDataFile(fileName: string): Promise<string | null> {
  const candidates = resolveCatalogDataPaths(fileName);

  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf-8");
    } catch {
      // Try next candidate path.
    }
  }

  return null;
}

function splitCsvLineByDelimiter(line: string, delimiter = ","): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      // Handle escaped quote inside quoted string.
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current.trim());
  return fields;
}

function joinMultilineCsvRecords(text: string): string[] {
  const rawLines = text.split(/\r?\n/);
  const joined: string[] = [];
  let buffer = "";
  let inQuotes = false;

  for (const line of rawLines) {
    if (buffer.length === 0) {
      buffer = line;
    } else {
      buffer += `\n${line}`;
    }

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char !== '"') {
        continue;
      }

      if (line[index + 1] === '"') {
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
    }

    if (!inQuotes) {
      const normalized = buffer.trim();
      if (normalized.length > 0) {
        joined.push(normalized);
      }
      buffer = "";
    }
  }

  if (buffer.trim().length > 0) {
    joined.push(buffer.trim());
  }

  return joined;
}

function normalizeCsvValue(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/""/g, '"')
    .trim();
}

function normalizeCsvHeader(value: string): string {
  return normalizeCsvValue(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildCatalogStockItem(
  input: {
    id: string;
    nomorObat: string;
    nama: string;
    detailSummary: string;
    restriksi?: string;
    peresepanMaksimal?: string;
    smf?: string;
    kelasTerapi?: string;
  },
  source: DemoMedicineDataSource,
): DemoStockItem {
  const baseStock = source === "kronis_rsi" ? 30 : 20;
  const spanStock = source === "kronis_rsi" ? 85 : 95;
  const stok = baseStock + (toStableCode(`${source}-${input.nama}`) % spanStock);

  return {
    id: input.id,
    nomorObat: input.nomorObat,
    nama: input.nama,
    stok,
    satuan: "unit",
    expiredAt: "N/A",
    lokasi: source === "kronis_rsi" ? "Katalog Obat Kronis RSI" : "Katalog e-Fornas",
    status: inferStockStatus(stok),
    source,
    detailSummary: input.detailSummary,
    restriksi: input.restriksi,
    peresepanMaksimal: input.peresepanMaksimal,
    smf: input.smf,
    kelasTerapi: input.kelasTerapi,
  };
}

async function loadKronisCatalogItems(): Promise<DemoStockItem[]> {
  const rawCsv = await readCatalogDataFile(KRONIS_CSV_FILE);
  if (!rawCsv) {
    return [];
  }

  const records = joinMultilineCsvRecords(rawCsv);
  if (records.length === 0) {
    return [];
  }

  const headers = splitCsvLineByDelimiter(records[0] ?? "", ",");
  const headerMap = new Map<string, number>();
  headers.forEach((header, index) => {
    headerMap.set(normalizeCsvHeader(header), index);
  });

  const noIndex = headerMap.get("no") ?? 0;
  const namaIndex = headerMap.get("nama") ?? 1;
  const restriksiIndex = headerMap.get("restriksi") ?? 2;
  const peresepanIndex =
    headerMap.get("peresepanmaksimal") ?? headerMap.get("peresepanmaksimal") ?? 3;
  const smfIndex = headerMap.get("smf") ?? 4;

  const results: DemoStockItem[] = [];
  const seenNames = new Set<string>();
  let fallbackCounter = 1;

  for (const record of records.slice(1)) {
    const columns = splitCsvLineByDelimiter(record, ",");
    const nama = normalizeCsvValue(columns[namaIndex]);
    if (!nama) {
      continue;
    }

    const uniqueName = normalizeComparisonText(nama);
    if (seenNames.has(uniqueName)) {
      continue;
    }

    seenNames.add(uniqueName);

    const rawNo = normalizeCsvValue(columns[noIndex]).replace(/[^0-9]/g, "");
    const nomorUrut = rawNo.length > 0 ? rawNo : String(fallbackCounter);
    const nomorObat = `KRN-${nomorUrut.padStart(4, "0")}`;
    const restriksi = normalizeCsvValue(columns[restriksiIndex]);
    const peresepanMaksimal = normalizeCsvValue(columns[peresepanIndex]);
    const smf = normalizeCsvValue(columns[smfIndex]);

    const detailParts = [
      "Data referensi dari daftar obat kronis RSI Surabaya.",
      smf ? `SMF: ${smf}.` : "",
      peresepanMaksimal ? `Peresepan maksimal: ${peresepanMaksimal}.` : "",
    ].filter((part) => part.length > 0);

    results.push(
      buildCatalogStockItem(
        {
          id: `cat-krn-${nomorObat.toLowerCase()}`,
          nomorObat,
          nama,
          detailSummary: detailParts.join(" "),
          restriksi: restriksi || undefined,
          peresepanMaksimal: peresepanMaksimal || undefined,
          smf: smf || undefined,
        },
        "kronis_rsi",
      ),
    );

    fallbackCounter += 1;
  }

  return results;
}

async function loadEfornasCatalogItems(): Promise<DemoStockItem[]> {
  const rawCsv = await readCatalogDataFile(EFORNAS_CSV_FILE);
  if (!rawCsv) {
    return [];
  }

  const records = joinMultilineCsvRecords(rawCsv);
  if (records.length === 0) {
    return [];
  }

  const headers = splitCsvLineByDelimiter(records[0] ?? "", ",");
  const headerMap = new Map<string, number>();
  headers.forEach((header, index) => {
    headerMap.set(normalizeCsvHeader(header), index);
  });

  const idIndex = headerMap.get("idobat") ?? 0;
  const namaIndex = headerMap.get("namaobat") ?? 1;
  const namaInternasionalIndex = headerMap.get("namaobatinternasional") ?? 2;
  const kelasIndex = headerMap.get("kelasterapi") ?? 3;
  const subKelasIndex = headerMap.get("subkelasterapi") ?? 4;
  const subSubKelasIndex = headerMap.get("subsubkelasterapi") ?? 5;
  const subSubSubKelasIndex = headerMap.get("subsubsubkelasterapi") ?? 6;
  const sediaanIndex = headerMap.get("sediaan") ?? 7;
  const kekuatanIndex = headerMap.get("kekuatan") ?? 8;
  const satuanIndex = headerMap.get("satuan") ?? 9;
  const restriksiObatIndex = headerMap.get("restriksiobat") ?? 23;
  const peresepanIndex = headerMap.get("peresepanmaksimal") ?? 25;

  const results: DemoStockItem[] = [];
  const seenKeys = new Set<string>();

  for (const record of records.slice(1)) {
    if (results.length >= EFORNAS_IMPORT_LIMIT) {
      break;
    }

    const columns = splitCsvLineByDelimiter(record, ",");
    const nama = normalizeCsvValue(columns[namaIndex]);
    if (!nama) {
      continue;
    }

    const sediaan = normalizeCsvValue(columns[sediaanIndex]);
    const kekuatan = normalizeCsvValue(columns[kekuatanIndex]);
    const satuan = normalizeCsvValue(columns[satuanIndex]);
    const uniqueKey = normalizeComparisonText(
      `${nama}-${sediaan}-${kekuatan}-${satuan}`,
    );

    if (seenKeys.has(uniqueKey)) {
      continue;
    }

    seenKeys.add(uniqueKey);

    const rawId = normalizeCsvValue(columns[idIndex]).replace(/[^0-9]/g, "");
    const nomorObat = `EFR-${(rawId || String(results.length + 1)).padStart(5, "0")}`;
    const namaInternasional = normalizeCsvValue(columns[namaInternasionalIndex]);
    const kelasTerapi = [
      normalizeCsvValue(columns[kelasIndex]),
      normalizeCsvValue(columns[subKelasIndex]),
      normalizeCsvValue(columns[subSubKelasIndex]),
      normalizeCsvValue(columns[subSubSubKelasIndex]),
    ]
      .filter((part) => part.length > 0)
      .join(" > ");

    const restriksi = normalizeCsvValue(columns[restriksiObatIndex]);
    const peresepanMaksimal = normalizeCsvValue(columns[peresepanIndex]);
    const sediaanDetail = [sediaan, kekuatan, satuan].filter((part) => part.length > 0).join(" ");

    const detailParts = [
      "Data referensi dari katalog e-Fornas Kemenkes RI.",
      namaInternasional ? `Nama internasional: ${namaInternasional}.` : "",
      sediaanDetail ? `Sediaan: ${sediaanDetail}.` : "",
    ].filter((part) => part.length > 0);

    results.push(
      buildCatalogStockItem(
        {
          id: `cat-efr-${nomorObat.toLowerCase()}`,
          nomorObat,
          nama,
          detailSummary: detailParts.join(" "),
          restriksi: restriksi || undefined,
          peresepanMaksimal: peresepanMaksimal || undefined,
          kelasTerapi: kelasTerapi || undefined,
        },
        "efornas",
      ),
    );
  }

  return results;
}

async function loadExternalCatalogItems(): Promise<DemoStockItem[]> {
  if (externalCatalogCache) {
    return externalCatalogCache;
  }

  if (!externalCatalogPromise) {
    externalCatalogPromise = (async () => {
      const [kronisItems, efornasItems] = await Promise.all([
        loadKronisCatalogItems(),
        loadEfornasCatalogItems(),
      ]);

      const combined = [...kronisItems, ...efornasItems];
      combined.sort((first, second) => first.nama.localeCompare(second.nama, "id"));
      externalCatalogCache = combined;
      return combined;
    })();
  }

  return externalCatalogPromise;
}

function mergeCatalogWithOperationalStock(
  catalogItems: DemoStockItem[],
  operationalItems: DemoStockItem[],
): DemoStockItem[] {
  const operationalByNumber = new Map<string, DemoStockItem>();
  const operationalByName = new Map<string, DemoStockItem>();

  for (const [index, item] of operationalItems.entries()) {
    const normalizedNomorObat = normalizeMedicineNumber(item.nomorObat, item.id, index + 1);
    if (!operationalByNumber.has(normalizedNomorObat)) {
      operationalByNumber.set(normalizedNomorObat, item);
    }

    const normalizedName = normalizeComparisonText(item.nama);
    if (!operationalByName.has(normalizedName)) {
      operationalByName.set(normalizedName, item);
    }
  }

  const catalogNumbers = new Set<string>();
  const mergedCatalog = catalogItems.map((catalogItem, index) => {
    const normalizedNomorObat = normalizeMedicineNumber(
      catalogItem.nomorObat,
      catalogItem.id,
      index + 1,
    );
    catalogNumbers.add(normalizedNomorObat);

    const operationalMatch =
      operationalByNumber.get(normalizedNomorObat) ??
      operationalByName.get(normalizeComparisonText(catalogItem.nama));

    if (!operationalMatch) {
      return {
        ...catalogItem,
        nomorObat: normalizedNomorObat,
        status: inferStockStatus(catalogItem.stok),
      };
    }

    const stock = Math.max(0, Math.round(operationalMatch.stok));
    return {
      ...catalogItem,
      nomorObat: normalizedNomorObat,
      stok: stock,
      satuan: operationalMatch.satuan || catalogItem.satuan,
      expiredAt: operationalMatch.expiredAt || catalogItem.expiredAt,
      lokasi: operationalMatch.lokasi || catalogItem.lokasi,
      status: inferStockStatus(stock),
    };
  });

  const operationalOnlyItems = operationalItems
    .filter((item, index) => {
      const normalizedNomorObat = normalizeMedicineNumber(item.nomorObat, item.id, index + 1);
      return !catalogNumbers.has(normalizedNomorObat);
    })
    .map((item, index) => {
      const normalizedNomorObat = normalizeMedicineNumber(item.nomorObat, item.id, index + 1);
      const stock = Math.max(0, Math.round(item.stok));

      return {
        ...item,
        nomorObat: normalizedNomorObat,
        status: inferStockStatus(stock),
        source: item.source ?? "operasional",
        detailSummary:
          item.detailSummary ?? "Data operasional stok dari sistem dispensing internal.",
      };
    });

  return [...mergedCatalog, ...operationalOnlyItems].sort((first, second) =>
    first.nama.localeCompare(second.nama, "id"),
  );
}

async function ensureOperationalStockItem(
  store: DemoWorkflowStore,
  nomorObat: string | undefined,
  medicineName: string,
  minimumStock: number,
): Promise<DemoStockItem | null> {
  const existing = findStockItemByOrderInput(store.stockItems, nomorObat, medicineName);
  if (existing) {
    return existing;
  }

  const catalogItems = await loadExternalCatalogItems();
  const catalogMatch = findStockItemByOrderInput(catalogItems, nomorObat, medicineName);
  const nextId = `ops-${randomUUID().slice(0, 8)}`;

  const fallbackStock = Math.max(1, Math.round(minimumStock));
  const seededStock = Math.max(
    fallbackStock,
    catalogMatch ? Math.max(0, Math.round(catalogMatch.stok)) : 0,
  );

  const seededItem: DemoStockItem = {
    id: nextId,
    nomorObat: normalizeMedicineNumber(catalogMatch?.nomorObat ?? nomorObat, nextId, store.stockItems.length + 1),
    nama: catalogMatch?.nama ?? medicineName,
    stok: seededStock,
    satuan: catalogMatch?.satuan ?? "unit",
    expiredAt: catalogMatch?.expiredAt ?? "N/A",
    lokasi: catalogMatch?.lokasi ?? "Operasional Dispensing",
    status: inferStockStatus(seededStock),
    source: catalogMatch?.source ?? "operasional",
    detailSummary:
      catalogMatch?.detailSummary ?? "Data operasional stok dari sistem dispensing internal.",
    restriksi: catalogMatch?.restriksi,
    peresepanMaksimal: catalogMatch?.peresepanMaksimal,
    smf: catalogMatch?.smf,
    kelasTerapi: catalogMatch?.kelasTerapi,
  };

  store.stockItems.push(seededItem);
  return seededItem;
}

function buildPrescriptionMedicineSummary(
  prescription: DemoPrescriptionRecord,
): DispensingPrescriptionErrorDetails["availableMedicines"] {
  return prescription.items.map((item) => ({
    nomorObat: item.nomorObat,
    medicineName: item.medicineName,
    dosage: item.dosis,
    quantity: item.qty,
  }));
}

function resolvePrescriptionForDispensing(
  store: DemoWorkflowStore,
  nomorRMInput: string | undefined,
  nomorPeresepanInput: string,
): DemoPrescriptionRecord {
  const normalizedNomorRM = nomorRMInput?.trim().toUpperCase() ?? "";

  if (!nomorPeresepanInput) {
    throw new DispensingPrescriptionError(
      "Nomor peresepan wajib diisi agar dispensing sesuai resep dokter.",
      {
        code: "nomor_peresepan_required",
        nomorRM: normalizedNomorRM || undefined,
      },
    );
  }

  const prescription = store.prescriptions.find(
    (item) => item.nomorPeresepan.toUpperCase() === nomorPeresepanInput,
  );

  if (!prescription) {
    throw new DispensingPrescriptionError(
      `Nomor peresepan ${nomorPeresepanInput} tidak ditemukan pada resep dokter.`,
      {
        code: "prescription_not_found",
        nomorPeresepan: nomorPeresepanInput,
        nomorRM: normalizedNomorRM || undefined,
      },
    );
  }

  const expectedNomorRM = prescription.nomorRM.toUpperCase();
  if (normalizedNomorRM.length > 0 && expectedNomorRM !== normalizedNomorRM) {
    throw new DispensingPrescriptionError(
      `Nomor RM ${normalizedNomorRM} tidak sesuai dengan resep ${prescription.nomorPeresepan}.`,
      {
        code: "patient_mismatch",
        nomorRM: normalizedNomorRM,
        expectedNomorRM,
        nomorPeresepan: prescription.nomorPeresepan,
        expectedPatientName: prescription.patientName,
        doctorName: prescription.doctorName,
      },
    );
  }

  return prescription;
}

interface CreateManualPrescriptionForDispensingInput {
  nomorRM: string;
  nomorPeresepan: string;
  patientName: string;
  doctorName?: string;
  nomorObat?: string;
  medicineName: string;
  dosage: string;
  quantity?: number;
  createdAt: string;
}

function createManualPrescriptionForDispensing(
  store: DemoWorkflowStore,
  input: CreateManualPrescriptionForDispensingInput,
): DemoPrescriptionRecord {
  const patientName = input.patientName.trim();
  if (!patientName) {
    throw new DispensingPrescriptionError(
      "Nama pasien wajib diisi saat membuat resep baru dari menu dispensing.",
      {
        code: "manual_patient_required",
        nomorRM: input.nomorRM,
        nomorPeresepan: input.nomorPeresepan,
      },
    );
  }

  const medicineName = input.medicineName.trim();
  if (!medicineName) {
    throw new DispensingPrescriptionError(
      "Nama obat wajib diisi saat membuat resep baru dari menu dispensing.",
      {
        code: "manual_medicine_required",
        nomorRM: input.nomorRM,
        nomorPeresepan: input.nomorPeresepan,
        patientName,
      },
    );
  }

  const dosage = input.dosage.trim();
  if (!dosage) {
    throw new DispensingPrescriptionError(
      "Dosis wajib diisi saat membuat resep baru dari menu dispensing.",
      {
        code: "manual_dosage_required",
        nomorRM: input.nomorRM,
        nomorPeresepan: input.nomorPeresepan,
        patientName,
        medicineName,
      },
    );
  }

  const quantity =
    typeof input.quantity === "number" && Number.isFinite(input.quantity)
      ? Math.max(1, Math.round(input.quantity))
      : 0;

  if (quantity <= 0) {
    throw new DispensingPrescriptionError(
      "Jumlah obat wajib diisi saat membuat resep baru dari menu dispensing.",
      {
        code: "manual_quantity_required",
        nomorRM: input.nomorRM,
        nomorPeresepan: input.nomorPeresepan,
        patientName,
        medicineName,
        dosage,
      },
    );
  }

  const prescriptionId = `prx-${randomUUID().slice(0, 8)}`;
  const fallbackMedicineId = `pri-${randomUUID().slice(0, 8)}`;
  const normalizedNomorRM = normalizeMedicalRecordNumber(input.nomorRM, patientName);
  const normalizedNomorPeresepan = normalizePrescriptionNumber(
    input.nomorPeresepan,
    prescriptionId,
    input.createdAt,
  );
  const doctorName =
    typeof input.doctorName === "string" && input.doctorName.trim().length > 0
      ? input.doctorName.trim()
      : "dr. Input Apoteker";

  const prescription: DemoPrescriptionRecord = {
    id: prescriptionId,
    nomorPeresepan: normalizedNomorPeresepan,
    nomorRM: normalizedNomorRM,
    patientName,
    doctorName,
    status: "dibuat",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    items: [
      {
        id: fallbackMedicineId,
        nomorObat: normalizeMedicineNumber(input.nomorObat, fallbackMedicineId, 1),
        medicineName,
        dosis: dosage,
        qty: quantity,
      },
    ],
  };

  store.prescriptions.push(prescription);
  return prescription;
}

function mapPrescriptionItemsToLookup(
  prescription: DemoPrescriptionRecord,
): DispensingPrescriptionLookupItem[] {
  return prescription.items.map((item) => ({
    nomorObat: item.nomorObat,
    medicineName: item.medicineName,
    dosage: item.dosis,
    quantity: item.qty,
    keteranganObat: `Dosis: ${item.dosis}. Jumlah resep: ${item.qty}.`,
  }));
}

function formatDuration(rawDuration: string): string {
  const trimmed = rawDuration.trim();
  if (!trimmed) {
    return "3 hari";
  }

  return trimmed;
}

export interface StockListOptions {
  nomorObatQuery?: string;
  includeCatalog?: boolean;
}

export async function listStockItems(options?: StockListOptions): Promise<DemoStockItem[]> {
  const store = await readStore();

  const normalizedItems: DemoStockItem[] = store.stockItems.map((item, index) => {
    const normalizedNomorObat = normalizeMedicineNumber(item.nomorObat, item.id, index + 1);

    return {
      ...item,
      nomorObat: normalizedNomorObat,
      status: inferStockStatus(item.stok),
      source: item.source ?? "operasional",
      detailSummary:
        item.detailSummary ??
        "Data operasional stok dari sistem dispensing internal.",
    };
  });

  let combinedItems: DemoStockItem[] = normalizedItems;

  if (options?.includeCatalog) {
    // Mode katalog menampilkan referensi kronis RSI + e-Fornas dengan overlay stok operasional terbaru.
    const catalogItems = await loadExternalCatalogItems();
    combinedItems = mergeCatalogWithOperationalStock(catalogItems, normalizedItems);
  }

  const query = options?.nomorObatQuery?.trim() ?? "";
  if (!query) {
    return combinedItems;
  }

  if (isLikelyMedicineNumberQuery(query)) {
    const normalizedQuery = normalizeMedicineNumberSearchText(query);

    return combinedItems.filter(
      (item) => normalizeMedicineNumberSearchText(item.nomorObat ?? "") === normalizedQuery,
    );
  }

  return combinedItems.filter((item) =>
    matchesMedicineSearchQuery(query, [
      item.nomorObat,
      item.nama,
      item.detailSummary,
      item.kelasTerapi,
      item.restriksi,
      item.peresepanMaksimal,
      item.smf,
      item.lokasi,
    ]),
  );
}

export function buildStockSummary(items: DemoStockItem[]): DemoStockSummary {
  return {
    totalItems: items.length,
    totalUnits: items.reduce((total, item) => total + item.stok, 0),
    menipisCount: items.filter((item) => item.status === "menipis").length,
    kritisCount: items.filter((item) => item.status === "kritis").length,
  };
}

export interface ListDispensingOrdersOptions {
  paymentStatus?: DemoPaymentStatus;
  workflowStatus?: DemoDispensingWorkflowStatus;
  nomorPeresepan?: string;
  nomorRM?: string;
  nomorObat?: string;
}

export async function listDispensingOrders(
  options?: ListDispensingOrdersOptions,
): Promise<DemoDispensingOrder[]> {
  const store = await readStore();
  const paymentStatusFilter = options?.paymentStatus;
  const workflowStatusFilter = options?.workflowStatus;
  const nomorPeresepanFilter = options?.nomorPeresepan?.trim().toUpperCase() ?? "";
  const nomorRMFilter = options?.nomorRM?.trim().toUpperCase() ?? "";
  const nomorObatFilter = options?.nomorObat?.trim().toUpperCase() ?? "";

  const filtered = store.dispensingOrders.filter((item) => {
    if (paymentStatusFilter && item.paymentStatus !== paymentStatusFilter) {
      return false;
    }

    if (workflowStatusFilter && resolveDispensingWorkflowStatus(item) !== workflowStatusFilter) {
      return false;
    }

    if (
      nomorPeresepanFilter.length > 0 &&
      (item.nomorPeresepan ?? "").trim().toUpperCase() !== nomorPeresepanFilter
    ) {
      return false;
    }

    if (
      nomorRMFilter.length > 0 &&
      (item.nomorRM ?? "").trim().toUpperCase() !== nomorRMFilter
    ) {
      return false;
    }

    if (nomorObatFilter.length > 0) {
      const candidateNomorObat = (item.nomorObat ?? "").trim().toUpperCase();
      if (!candidateNomorObat.includes(nomorObatFilter)) {
        return false;
      }
    }

    return true;
  });

  return [...filtered].sort((a, b) => compareByDateDesc(a.createdAt, b.createdAt));
}

function findExistingDispensingOrderForPrescriptionItem(
  orders: DemoDispensingOrder[],
  input: {
    nomorPeresepan: string;
    nomorObat: string;
  },
): DemoDispensingOrder | null {
  const normalizedNomorPeresepan = input.nomorPeresepan.trim().toUpperCase();
  const normalizedNomorObat = input.nomorObat.trim().toUpperCase();

  for (let index = 0; index < orders.length; index += 1) {
    const candidate = orders[index];
    const candidateNomorPeresepan = (candidate.nomorPeresepan ?? "").trim().toUpperCase();
    if (!candidateNomorPeresepan || candidateNomorPeresepan !== normalizedNomorPeresepan) {
      continue;
    }

    const candidateNomorObat = normalizeMedicineNumber(candidate.nomorObat, candidate.id, index + 1);
    if (candidateNomorObat !== normalizedNomorObat) {
      continue;
    }

    const candidateWorkflowStatus = resolveDispensingWorkflowStatus(candidate);
    if (candidateWorkflowStatus === "cancel") {
      continue;
    }

    return candidate;
  }

  return null;
}

function findStockItemByOrderInput(
  stockItems: DemoStockItem[],
  nomorObat: string | undefined,
  medicineName: string,
): DemoStockItem | null {
  const normalizedNumber = nomorObat?.trim().toUpperCase();
  if (normalizedNumber) {
    const byNumber = stockItems.find(
      (item, index) =>
        normalizeMedicineNumber(item.nomorObat, item.id, index + 1) === normalizedNumber,
    );
    if (byNumber) {
      return byNumber;
    }
  }

  const normalizedName = medicineName.trim().toLowerCase();
  if (!normalizedName) {
    return null;
  }

  return (
    stockItems.find((item) => {
      const stockName = item.nama.toLowerCase();
      return (
        stockName === normalizedName ||
        stockName.includes(normalizedName) ||
        normalizedName.includes(stockName)
      );
    }) ?? null
  );
}

function findPrescriptionItemByOrderInput(
  prescription: DemoPrescriptionRecord,
  nomorObat: string,
  medicineName: string,
): DemoPrescriptionRecord["items"][number] | null {
  const byName = medicineName
    ? prescription.items.find((item) =>
        matchesByComparisonText(item.medicineName, medicineName),
      ) ?? null
    : null;

  const byNumber = nomorObat
    ? prescription.items.find((item) => item.nomorObat.toUpperCase() === nomorObat) ?? null
    : null;

  if (byName && byNumber && byName.nomorObat.toUpperCase() !== byNumber.nomorObat.toUpperCase()) {
    return byName;
  }

  return byNumber ?? byName;
}

function appendPrescriptionItemForDispensing(
  prescription: DemoPrescriptionRecord,
  input: {
    nomorObat?: string;
    medicineName: string;
    dosage: string;
    quantity: number;
  },
): DemoPrescriptionRecord["items"][number] {
  const item: DemoPrescriptionRecord["items"][number] = {
    id: `prx-item-${randomUUID().slice(0, 8)}`,
    nomorObat: normalizeMedicineNumber(
      input.nomorObat,
      prescription.id,
      prescription.items.length + 1,
    ),
    medicineName: input.medicineName.trim(),
    dosis: input.dosage.trim(),
    qty: Math.max(1, Math.round(input.quantity)),
  };

  prescription.items.push(item);
  prescription.updatedAt = new Date().toISOString();
  return item;
}

function syncPrescriptionItemFromOrder(
  store: DemoWorkflowStore,
  order: DemoDispensingOrder,
): void {
  const nomorPeresepan = order.nomorPeresepan?.trim().toUpperCase() ?? "";
  if (!nomorPeresepan) {
    return;
  }

  const prescription = store.prescriptions.find(
    (item) => item.nomorPeresepan.toUpperCase() === nomorPeresepan,
  );
  if (!prescription) {
    return;
  }

  const nomorObat = order.nomorObat?.trim().toUpperCase() ?? "";
  let item =
    (nomorObat
      ? prescription.items.find((entry) => entry.nomorObat.toUpperCase() === nomorObat)
      : null) ??
    prescription.items.find((entry) =>
      matchesByComparisonText(entry.medicineName, order.medicineName),
    ) ??
    null;

  if (!item && prescription.items.length === 1) {
    item = prescription.items[0] ?? null;
  }

  if (!item) {
    appendPrescriptionItemForDispensing(prescription, {
      nomorObat: order.nomorObat,
      medicineName: order.medicineName,
      dosage: order.dosage,
      quantity: order.quantity,
    });
    return;
  }

  item.medicineName = order.medicineName;
  item.nomorObat = normalizeMedicineNumber(order.nomorObat, item.id, 1);
  item.dosis = order.dosage;
  item.qty = Math.max(1, Math.round(order.quantity));
  prescription.updatedAt = order.updatedAt ?? order.createdAt;
}

function upsertPatientFromOrder(
  store: DemoWorkflowStore,
  order: DemoDispensingOrder,
  patientUserId?: string,
): void {
  const nomorRM = normalizeMedicalRecordNumber(order.nomorRM, order.patientName);
  const normalizedUserId = normalizeOptionalUserId(patientUserId);
  const existing = store.patients.find((item) => item.nomorRM === nomorRM);
  if (existing) {
    existing.nama = order.patientName;
    if (normalizedUserId) {
      existing.userId = normalizedUserId;
    }
    existing.updatedAt = order.updatedAt ?? order.createdAt;
    return;
  }

  store.patients.push({
    id: `pt-${randomUUID().slice(0, 8)}`,
    userId: normalizedUserId,
    nomorRM,
    nama: order.patientName,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt ?? order.createdAt,
  });
}

function upsertPrescriptionFromOrder(store: DemoWorkflowStore, order: DemoDispensingOrder): void {
  const nomorPeresepan = normalizePrescriptionNumber(order.nomorPeresepan, order.id, order.createdAt);
  const existing = store.prescriptions.find((item) => item.nomorPeresepan === nomorPeresepan);

  const prescriptionStatus =
    order.paymentStatus === "lunas"
      ? "siap_proses"
      : order.paymentStatus === "dibatalkan" || order.paymentStatus === "gagal"
        ? "batal"
        : "dibuat";

  const nextItem = {
    id: `pri-${randomUUID().slice(0, 8)}`,
    nomorObat: normalizeMedicineNumber(order.nomorObat, order.id, 1),
    medicineName: order.medicineName,
    dosis: order.dosage,
    qty: order.quantity,
  };

  if (existing) {
    existing.nomorRM = normalizeMedicalRecordNumber(order.nomorRM, order.patientName);
    existing.patientName = order.patientName;
    existing.status = prescriptionStatus;
    existing.updatedAt = order.updatedAt ?? order.createdAt;
    if (existing.items.length === 0) {
      existing.items = [nextItem];
    }
    return;
  }

  store.prescriptions.push({
    id: `prx-${randomUUID().slice(0, 8)}`,
    nomorPeresepan,
    nomorRM: normalizeMedicalRecordNumber(order.nomorRM, order.patientName),
    patientName: order.patientName,
    doctorName: "dr. Integrasi RSI",
    status: prescriptionStatus,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt ?? order.createdAt,
    items: [nextItem],
  });
}

function upsertCashierPaymentFromOrder(store: DemoWorkflowStore, order: DemoDispensingOrder): void {
  const nomorPeresepan = normalizePrescriptionNumber(order.nomorPeresepan, order.id, order.createdAt);
  const totalTagihan = Math.max(0, order.quantity * 5000);
  const statusBayar = normalizePaymentStatus(
    order.paymentStatus,
    inferPaymentStatusFromLegacyStatus(order.status),
  );
  const totalDibayar = statusBayar === "lunas" ? totalTagihan : 0;

  const existing = store.cashierPayments.find((item) => item.nomorPeresepan === nomorPeresepan);
  if (existing) {
    existing.statusBayar = statusBayar;
    existing.totalTagihan = totalTagihan;
    existing.totalDibayar = totalDibayar;
    existing.metodeBayar = statusBayar === "lunas" ? existing.metodeBayar ?? "cash" : undefined;
    existing.paidAt = statusBayar === "lunas" ? order.updatedAt ?? order.createdAt : undefined;
    existing.updatedAt = order.updatedAt ?? order.createdAt;
    return;
  }

  store.cashierPayments.push({
    id: `pay-${randomUUID().slice(0, 8)}`,
    nomorPeresepan,
    statusBayar,
    totalTagihan,
    totalDibayar,
    metodeBayar: statusBayar === "lunas" ? "cash" : undefined,
    paidAt: statusBayar === "lunas" ? order.updatedAt ?? order.createdAt : undefined,
    updatedAt: order.updatedAt ?? order.createdAt,
  });
}

function pushStockTransaction(
  store: DemoWorkflowStore,
  input: Omit<DemoMedicineTransaction, "id">,
): void {
  store.medicineTransactions.push({
    id: `txn-${randomUUID().slice(0, 8)}`,
    ...input,
  });
}

export async function createDispensingOrder(
  input: CreateDispensingInput,
): Promise<DemoDispensingOrder> {
  return withWriteLock(async () => {
    const store = await readStore();
    const now = new Date().toISOString();

    const patientNameInput = input.patientName?.trim() ?? "";
    const medicineNameInput = input.medicineName?.trim() ?? "";
    const dosageInput = input.dosage?.trim() ?? "";
    const requestedQuantity =
      typeof input.quantity === "number" && Number.isFinite(input.quantity)
        ? Math.max(1, Math.round(input.quantity))
        : undefined;
    const orderId = `dsp-${randomUUID().slice(0, 8)}`;
    const nomorRMInput = input.nomorRM?.trim().toUpperCase() ?? "";
    const nomorPeresepanInput = input.nomorPeresepan?.trim().toUpperCase() ?? "";
    const nomorObatInput = input.nomorObat?.trim().toUpperCase() ?? "";
    const shouldAutoCreatePrescription = input.autoCreatePrescription === true;
    const allowCustomPrescriptionItem =
      input.allowCustomPrescriptionItem === true || shouldAutoCreatePrescription;
    const patientUserId = normalizeOptionalUserId(input.patientUserId);

    let prescription: DemoPrescriptionRecord;
    try {
      prescription = resolvePrescriptionForDispensing(
        store,
        nomorRMInput,
        nomorPeresepanInput,
      );
    } catch (error) {
      if (
        shouldAutoCreatePrescription &&
        error instanceof DispensingPrescriptionError &&
        error.details.code === "prescription_not_found"
      ) {
        prescription = createManualPrescriptionForDispensing(store, {
          nomorRM: nomorRMInput,
          nomorPeresepan: nomorPeresepanInput,
          patientName: patientNameInput,
          doctorName: input.doctorName,
          nomorObat: nomorObatInput || undefined,
          medicineName: medicineNameInput,
          dosage: dosageInput,
          quantity: requestedQuantity,
          createdAt: now,
        });
      } else {
        throw error;
      }
    }

    if (
      patientNameInput.length > 0 &&
      !matchesByComparisonText(patientNameInput, prescription.patientName)
    ) {
      throw new DispensingPrescriptionError(
        `Nama pasien tidak sesuai dengan data resep dokter ${prescription.nomorPeresepan}.`,
        {
          code: "patient_mismatch",
          nomorRM: nomorRMInput,
          nomorPeresepan: prescription.nomorPeresepan,
          patientName: patientNameInput,
          expectedPatientName: prescription.patientName,
          doctorName: prescription.doctorName,
        },
      );
    }

    let matchedPrescriptionItem = findPrescriptionItemByOrderInput(
      prescription,
      nomorObatInput,
      medicineNameInput,
    );

    if (
      !matchedPrescriptionItem &&
      !nomorObatInput &&
      !medicineNameInput &&
      prescription.items.length === 1
    ) {
      matchedPrescriptionItem = prescription.items[0] ?? null;
    }

    if (
      !matchedPrescriptionItem &&
      allowCustomPrescriptionItem &&
      medicineNameInput.length > 0
    ) {
      matchedPrescriptionItem = appendPrescriptionItemForDispensing(prescription, {
        nomorObat: nomorObatInput || undefined,
        medicineName: medicineNameInput,
        dosage: dosageInput || "1 x 1",
        quantity: requestedQuantity ?? 1,
      });
    }

    if (!matchedPrescriptionItem) {
      throw new DispensingPrescriptionError(
        `Obat yang diinput tidak ditemukan pada resep dokter ${prescription.nomorPeresepan}.`,
        {
          code: "medicine_not_in_prescription",
          nomorRM: nomorRMInput,
          nomorPeresepan: prescription.nomorPeresepan,
          medicineName: medicineNameInput,
          availableMedicines: buildPrescriptionMedicineSummary(prescription),
          doctorName: prescription.doctorName,
        },
      );
    }

    if (
      !allowCustomPrescriptionItem &&
      dosageInput.length > 0 &&
      normalizeComparisonText(dosageInput) !==
        normalizeComparisonText(matchedPrescriptionItem.dosis)
    ) {
      throw new DispensingPrescriptionError(
        `Dosis ${dosageInput} tidak sesuai dengan resep dokter untuk ${matchedPrescriptionItem.medicineName}.`,
        {
          code: "dosage_mismatch",
          nomorRM: nomorRMInput,
          nomorPeresepan: prescription.nomorPeresepan,
          medicineName: matchedPrescriptionItem.medicineName,
          expectedMedicineName: matchedPrescriptionItem.medicineName,
          dosage: dosageInput,
          expectedDosage: matchedPrescriptionItem.dosis,
          doctorName: prescription.doctorName,
        },
      );
    }

    const quantity = requestedQuantity ?? matchedPrescriptionItem.qty;

    if (
      !allowCustomPrescriptionItem &&
      requestedQuantity !== undefined &&
      quantity !== matchedPrescriptionItem.qty
    ) {
      throw new DispensingPrescriptionError(
        `Jumlah obat (${quantity}) tidak sesuai dengan resep dokter (${matchedPrescriptionItem.qty}).`,
        {
          code: "quantity_mismatch",
          nomorRM: nomorRMInput,
          nomorPeresepan: prescription.nomorPeresepan,
          medicineName: matchedPrescriptionItem.medicineName,
          quantity,
          expectedQuantity: matchedPrescriptionItem.qty,
          doctorName: prescription.doctorName,
        },
      );
    }

    const patientName = prescription.patientName;
    const medicineName = medicineNameInput || matchedPrescriptionItem.medicineName;
    const nomorRM = prescription.nomorRM;
    const nomorPeresepan = prescription.nomorPeresepan;
    const nomorObat = normalizeMedicineNumber(
      nomorObatInput || matchedPrescriptionItem.nomorObat,
      orderId,
      1,
    );
    const dosage = dosageInput || matchedPrescriptionItem.dosis;
    const existingOrder = findExistingDispensingOrderForPrescriptionItem(store.dispensingOrders, {
      nomorPeresepan,
      nomorObat,
    });

    if (existingOrder) {
      throw new DispensingPrescriptionError(
        `Order dispensing untuk ${nomorPeresepan} dan ${nomorObat} sudah tersedia. Lanjutkan dari order yang sudah ada pada daftar dispensing.`,
        {
          code: "duplicate_dispensing_order",
          nomorRM,
          nomorPeresepan,
          medicineName,
          existingOrderId: existingOrder.id,
          existingWorkflowStatus: resolveDispensingWorkflowStatus(existingOrder),
          existingPaymentStatus: normalizePaymentStatus(
            existingOrder.paymentStatus,
            inferPaymentStatusFromLegacyStatus(existingOrder.status),
          ),
        },
      );
    }

    const cashierPayment = store.cashierPayments.find(
      (item) => item.nomorPeresepan.toUpperCase() === prescription.nomorPeresepan.toUpperCase(),
    );
    const paymentStatus = normalizePaymentStatus(
      cashierPayment?.statusBayar ?? input.paymentStatus,
      "menunggu_bayar",
    );
    const stockMatch = findStockItemByOrderInput(store.stockItems, nomorObat, medicineName);

    const initialStatus: DemoDispensingOrder["status"] =
      paymentStatus === "lunas" ? "diracik" : "diterima";

    const order: DemoDispensingOrder = {
      id: orderId,
      patientName,
      nomorRM,
      nomorPeresepan,
      nomorObat,
      medicineName,
      dosage,
      quantity,
      status: initialStatus,
      workflowStatus: inferWorkflowStatus(initialStatus, paymentStatus),
      paymentStatus,
      updatedAt: now,
      createdAt: now,
    };

    store.dispensingOrders.push(order);
    upsertPatientFromOrder(store, order, patientUserId);
    upsertPrescriptionFromOrder(store, order);
    upsertCashierPaymentFromOrder(store, order);

    await writeStore(store);

    return order;
  });
}

export async function getDispensingPrescriptionLookup(
  nomorRM: string | undefined,
  nomorPeresepan: string,
): Promise<DispensingPrescriptionLookupResult> {
  const store = await readStore();
  const normalizedNomorRM = nomorRM?.trim().toUpperCase() ?? "";
  const normalizedNomorPeresepan = nomorPeresepan.trim().toUpperCase();
  const prescription = resolvePrescriptionForDispensing(
    store,
    normalizedNomorRM || undefined,
    normalizedNomorPeresepan,
  );

  return {
    nomorRM: prescription.nomorRM,
    nomorPeresepan: prescription.nomorPeresepan,
    patientName: prescription.patientName,
    doctorName: prescription.doctorName,
    status: prescription.status,
    items: mapPrescriptionItemsToLookup(prescription),
  };
}

export async function updateDispensingOrderDetails(
  input: UpdateDispensingOrderDetailsInput,
): Promise<DemoDispensingOrder> {
  return withWriteLock(async () => {
    const store = await readStore();
    const now = new Date().toISOString();
    const normalizedOrderId = input.orderId.trim();
    const order = store.dispensingOrders.find((item) => item.id === normalizedOrderId);

    if (!order) {
      throw new DispensingOrderManageError(
        `Order dispensing dengan ID ${normalizedOrderId} tidak ditemukan.`,
        { code: "order_not_found", orderId: normalizedOrderId },
      );
    }

    const workflowStatus = resolveDispensingWorkflowStatus(order);
    if (workflowStatus === "diserahkan" || workflowStatus === "cancel") {
      throw new DispensingOrderManageError(
        "Data obat tidak bisa diubah setelah order selesai atau dibatalkan.",
        { code: "order_locked", orderId: order.id },
      );
    }

    const medicineNameInput = input.medicineName?.trim() ?? "";
    const nomorObatInput = input.nomorObat?.trim().toUpperCase() ?? "";
    const dosageInput = input.dosage?.trim() ?? "";

    if (medicineNameInput.length > 0) {
      if (medicineNameInput.length < 2 || medicineNameInput.length > 120) {
        throw new DispensingOrderManageError("Nama obat tidak valid.", {
          code: "invalid_field",
          orderId: order.id,
        });
      }
      order.medicineName = medicineNameInput;
    }

    if (nomorObatInput.length > 0) {
      order.nomorObat = normalizeMedicineNumber(nomorObatInput, order.id, 1);
    }

    if (dosageInput.length > 0) {
      if (dosageInput.length < 2 || dosageInput.length > 120) {
        throw new DispensingOrderManageError("Dosis tidak valid.", {
          code: "invalid_field",
          orderId: order.id,
        });
      }
      order.dosage = dosageInput;
    }

    if (typeof input.quantity === "number" && Number.isFinite(input.quantity)) {
      const quantity = Math.max(1, Math.round(input.quantity));
      if (quantity > 500) {
        throw new DispensingOrderManageError(
          "Jumlah obat terlalu besar untuk mode demo (maksimal 500).",
          { code: "invalid_field", orderId: order.id },
        );
      }
      order.quantity = quantity;
    }

    order.updatedAt = now;
    syncPrescriptionItemFromOrder(store, order);
    upsertCashierPaymentFromOrder(store, order);

    await writeStore(store);
    return order;
  });
}

export async function cancelDispensingOrderWithRefund(
  input: CancelDispensingOrderInput,
): Promise<{
  order: DemoDispensingOrder;
  refunded: boolean;
  refundAmount: number;
}> {
  return withWriteLock(async () => {
    const store = await readStore();
    const now = new Date().toISOString();
    const normalizedOrderId = input.orderId.trim();
    const order = store.dispensingOrders.find((item) => item.id === normalizedOrderId);

    if (!order) {
      throw new DispensingOrderManageError(
        `Order dispensing dengan ID ${normalizedOrderId} tidak ditemukan.`,
        { code: "order_not_found", orderId: normalizedOrderId },
      );
    }

    const workflowStatus = resolveDispensingWorkflowStatus(order);
    if (workflowStatus === "cancel") {
      throw new DispensingOrderManageError("Order dispensing sudah dibatalkan.", {
        code: "already_cancelled",
        orderId: order.id,
      });
    }

    if (workflowStatus === "diserahkan") {
      throw new DispensingOrderManageError(
        "Order yang sudah diserahkan tidak bisa dibatalkan dari antrean.",
        { code: "order_locked", orderId: order.id },
      );
    }

    const paymentStatus = normalizePaymentStatus(
      order.paymentStatus,
      inferPaymentStatusFromLegacyStatus(order.status),
    );

    let refunded = false;
    let refundAmount = 0;
    const cancelReason = input.reason?.trim() || "Dibatalkan oleh apoteker";

    if (paymentStatus === "lunas") {
      refundAmount = Math.max(0, order.quantity * 5000);
      order.paymentStatus = "refund";
      refunded = true;

      const nomorPeresepan = order.nomorPeresepan?.trim().toUpperCase() ?? "";
      const payment = store.cashierPayments.find(
        (item) => item.nomorPeresepan.toUpperCase() === nomorPeresepan,
      );
      if (payment) {
        payment.statusBayar = "refund";
        payment.totalDibayar = 0;
        payment.updatedAt = now;
      }
    } else {
      order.paymentStatus = "dibatalkan";
    }

    order.workflowStatus = "cancel";
    order.cancelReason = cancelReason;
    order.updatedAt = now;

    await writeStore(store);

    return { order, refunded, refundAmount };
  });
}

export async function updateDispensingOrderWorkflow(
  input: UpdateDispensingWorkflowInput,
): Promise<DemoDispensingOrder> {
  return withWriteLock(async () => {
    const store = await readStore();
    const now = new Date().toISOString();
    const normalizedOrderId = input.orderId.trim();
    const order = store.dispensingOrders.find((item) => item.id === normalizedOrderId);

    if (!order) {
      throw new DispensingWorkflowUpdateError(
        `Order dispensing dengan ID ${normalizedOrderId} tidak ditemukan.`,
        {
          code: "order_not_found",
          orderId: normalizedOrderId,
        },
      );
    }

    if (resolveDispensingWorkflowStatus(order) === "cancel") {
      throw new DispensingWorkflowUpdateError(
        "Order yang sudah dibatalkan tidak bisa diproses lagi.",
        {
          code: "invalid_transition",
          orderId: order.id,
          currentWorkflowStatus: "cancel",
          targetWorkflowStatus: input.targetWorkflowStatus,
          paymentStatus: normalizePaymentStatus(
            order.paymentStatus,
            inferPaymentStatusFromLegacyStatus(order.status),
          ),
        },
      );
    }

    const paymentStatus = normalizePaymentStatus(
      order.paymentStatus,
      inferPaymentStatusFromLegacyStatus(order.status),
    );

    if (paymentStatus !== "lunas") {
      throw new DispensingWorkflowUpdateError(
        "Status peracikan hanya bisa diperbarui jika pembayaran sudah lunas.",
        {
          code: "payment_not_completed",
          orderId: order.id,
          paymentStatus,
          currentWorkflowStatus: resolveDispensingWorkflowStatus(order),
          targetWorkflowStatus: input.targetWorkflowStatus,
        },
      );
    }

    const currentWorkflowStatus = resolveDispensingWorkflowStatus(order);
    const currentStep = workflowStepFromStatus(currentWorkflowStatus);
    const targetStep = workflowStepFromStatus(input.targetWorkflowStatus);
    const expectedNextWorkflowStatus = workflowStepToTargetStatus(currentStep + 1);

    if (!expectedNextWorkflowStatus || targetStep !== currentStep + 1) {
      throw new DispensingWorkflowUpdateError(
        "Urutan konfirmasi peracikan tidak valid. Lanjutkan sesuai tahapan proses.",
        {
          code: "invalid_transition",
          orderId: order.id,
          currentWorkflowStatus,
          targetWorkflowStatus: input.targetWorkflowStatus,
          expectedNextWorkflowStatus: expectedNextWorkflowStatus ?? undefined,
          paymentStatus,
        },
      );
    }

    if (input.targetWorkflowStatus === "diserahkan" && currentWorkflowStatus !== "diserahkan") {
      const alreadyHasStockTransaction = store.medicineTransactions.some(
        (transaction) =>
          transaction.referenceType === "dispensing" &&
          transaction.referenceId === order.id &&
          transaction.movementType === "keluar",
      );

      if (!alreadyHasStockTransaction) {
        const stockMatch = await ensureOperationalStockItem(
          store,
          order.nomorObat,
          order.medicineName,
          order.quantity,
        );

        if (stockMatch) {
          const beforeQty = Math.max(0, Math.round(stockMatch.stok));
          if (order.quantity > beforeQty) {
            throw new InsufficientStockError(stockMatch.nama, beforeQty, order.quantity);
          }

          const afterQty = Math.max(0, beforeQty - order.quantity);
          stockMatch.stok = afterQty;
          stockMatch.status = inferStockStatus(afterQty);

          pushStockTransaction(store, {
            nomorObat: normalizeMedicineNumber(order.nomorObat, order.id, 1),
            movementType: "keluar",
            quantity: order.quantity,
            beforeQty,
            afterQty,
            referenceType: "dispensing",
            referenceId: order.id,
            actorUserId: input.actorUserId,
            note: `Penyerahan obat keluar untuk resep ${order.nomorPeresepan}`,
            occurredAt: now,
          });
        }
      }
    }

    order.workflowStatus = input.targetWorkflowStatus;
    order.status = mapWorkflowStatusToDispensingStatus(input.targetWorkflowStatus);
    order.updatedAt = now;

    await writeStore(store);

    return order;
  });
}

export async function validatePrescription(
  input: ValidatePrescriptionInput,
): Promise<DemoPrescriptionValidationResult> {
  const medicineName = input.medicineName.trim().toLowerCase();
  const dosage = input.dosage.trim().toLowerCase();
  const frequency = input.frequency.trim().toLowerCase();
  const allergies = input.allergies.trim().toLowerCase();
  const companion = input.companionMedicines.trim().toLowerCase();
  const activeMedicines = input.activeMedicines?.trim().toLowerCase() ?? "";
  const diagnosisSummary = input.diagnosisSummary?.trim().toLowerCase() ?? "";
  const nomorObat = input.nomorObat?.trim().toUpperCase() ?? "";
  const quantity =
    typeof input.quantity === "number" && Number.isFinite(input.quantity)
      ? Math.max(1, Math.round(input.quantity))
    : 1;
  const interactionSources = [companion, activeMedicines].filter((item) => item.length > 0).join(", ");

  const checks: DemoPrescriptionValidationResult["checks"] = [];

  const missingFields: string[] = [];
  if (!dosage) {
    missingFields.push("dosis");
  }
  if (!frequency) {
    missingFields.push("frekuensi");
  }
  if (!diagnosisSummary) {
    missingFields.push("diagnosis utama");
  }

  checks.push({
    name: "Kelengkapan Data",
    flag:
      missingFields.length >= 2
        ? "critical"
        : missingFields.length === 1
          ? "warning"
          : "ok",
    message:
      missingFields.length === 0
        ? "Data utama resep lengkap untuk validasi klinis awal."
        : `Lengkapi data ${missingFields.join(", ")} agar validasi lebih akurat.`,
  });

  checks.push({
    name: "Tipe Obat",
    flag: medicineName.length >= 3 ? "ok" : "warning",
    message:
      medicineName.length >= 3
        ? "Nama obat terdeteksi dengan baik."
        : "Nama obat terlalu singkat, perlu verifikasi manual.",
  });

  const dosageMatch = dosage.match(/(\d+)\s*mg/);
  const dosageMg = dosageMatch ? Number.parseInt(dosageMatch[1] ?? "0", 10) : 0;
  const frequencyHigh = /x\s*4|4x|x\s*5|5x/.test(frequency);
  const unusualFrequency = /x\s*0|0x|x\s*6|6x|x\s*7|7x/.test(frequency);

  if (dosageMg >= 1000 || frequencyHigh || unusualFrequency) {
    checks.push({
      name: "Dosis",
      flag: "critical",
      message: "Dosis/frekuensi tinggi, wajib konfirmasi dokter sebelum lanjut.",
    });
  } else if (dosageMg >= 850) {
    checks.push({
      name: "Dosis",
      flag: "warning",
      message: "Dosis relatif tinggi, lakukan cross-check dengan diagnosa pasien.",
    });
  } else {
    checks.push({
      name: "Dosis",
      flag: "ok",
      message: "Dosis berada pada rentang aman untuk skenario demo.",
    });
  }

  const stockItems = await listStockItems();
  const stockMatch = stockItems.find((item) => {
    if (nomorObat && item.nomorObat?.toUpperCase() === nomorObat) {
      return true;
    }

    return item.nama.trim().toLowerCase() === medicineName;
  });

  if (!stockMatch) {
    checks.push({
      name: "Ketersediaan Stok",
      flag: "warning",
      message:
        "Data stok obat tidak ditemukan dari input saat ini. Verifikasi nomor obat atau sinkronkan katalog.",
    });
  } else if (stockMatch.stok <= 0 || stockMatch.stok < quantity) {
    checks.push({
      name: "Ketersediaan Stok",
      flag: "critical",
      message: `Stok ${stockMatch.nama} tidak cukup. Tersedia ${stockMatch.stok}, dibutuhkan ${quantity}.`,
    });
  } else if (stockMatch.status === "kritis" || stockMatch.status === "menipis") {
    checks.push({
      name: "Ketersediaan Stok",
      flag: "warning",
      message: `Stok ${stockMatch.nama} tersedia ${stockMatch.stok} (${stockMatch.status}). Prioritaskan replenishment.`,
    });
  } else {
    checks.push({
      name: "Ketersediaan Stok",
      flag: "ok",
      message: `Stok ${stockMatch.nama} aman (${stockMatch.stok} unit) untuk pemrosesan resep.`,
    });
  }

  const hasHighInteractionRisk =
    interactionSources.length > 0 &&
    ((medicineName.includes("warfarin") &&
      (interactionSources.includes("aspirin") || interactionSources.includes("ibuprofen"))) ||
      (interactionSources.includes("warfarin") && medicineName.includes("aspirin")));

  if (hasHighInteractionRisk) {
    checks.push({
      name: "Interaksi",
      flag: "critical",
      message: "Interaksi berisiko tinggi terdeteksi (warfarin dengan NSAID).",
    });
  } else if (interactionSources.length > 0) {
    checks.push({
      name: "Interaksi",
      flag: "warning",
      message: "Ada obat pendamping/obat aktif, lanjutkan verifikasi interaksi detail.",
    });
  } else {
    checks.push({
      name: "Interaksi",
      flag: "ok",
      message: "Tidak ada interaksi berat terdeteksi pada input saat ini.",
    });
  }

  const allergyConflict =
    (allergies.includes("penicillin") && medicineName.includes("amoxicillin")) ||
    (allergies.includes("nsaid") && medicineName.includes("ibuprofen")) ||
    (allergies.length > 0 && medicineName.length > 0 && allergies.includes(medicineName));

  if (allergyConflict) {
    checks.push({
      name: "Alergi",
      flag: "critical",
      message: "Ada potensi konflik alergi, hentikan proses dan konsultasi dokter.",
    });
  } else if (allergies.length > 0) {
    checks.push({
      name: "Alergi",
      flag: "warning",
      message: "Data alergi tersedia, tetapi belum ditemukan konflik langsung.",
    });
  } else {
    checks.push({
      name: "Alergi",
      flag: "ok",
      message: "Tidak ada data alergi pada input saat ini.",
    });
  }

  const hasContraindicationRisk =
    (diagnosisSummary.includes("gagal ginjal") && /ibuprofen|diclofenac|ketorolac/.test(medicineName)) ||
    (diagnosisSummary.includes("asma") && medicineName.includes("aspirin")) ||
    (diagnosisSummary.includes("ulkus") && /ibuprofen|diclofenac|aspirin/.test(medicineName));

  if (hasContraindicationRisk) {
    checks.push({
      name: "Kontraindikasi Diagnosis",
      flag: "critical",
      message:
        "Potensi kontraindikasi terhadap diagnosis utama terdeteksi. Tinjau ulang bersama dokter.",
    });
  } else if (diagnosisSummary.length > 0) {
    checks.push({
      name: "Kontraindikasi Diagnosis",
      flag: "ok",
      message: "Tidak ada kontraindikasi berat yang terdeteksi dari diagnosis utama yang diinput.",
    });
  } else {
    checks.push({
      name: "Kontraindikasi Diagnosis",
      flag: "warning",
      message: "Diagnosis utama belum diisi. Risiko kontraindikasi belum dapat ditinjau optimal.",
    });
  }

  const hasCritical = checks.some((item) => item.flag === "critical");
  const hasWarning = checks.some((item) => item.flag === "warning");

  return {
    checkedAt: new Date().toISOString(),
    checks,
    canProceed: !hasCritical,
    recommendation: hasCritical
      ? "Jangan lanjutkan dispensing sebelum konfirmasi dokter penanggung jawab."
      : hasWarning
        ? "Boleh lanjut dengan verifikasi tambahan oleh apoteker."
        : "Resep aman diproses pada alur demo.",
  };
}

export function createLabelPreview(input: CreateLabelInput): DemoLabelPreview {
  const generatedAt = new Date().toISOString();
  const suffix = Date.now().toString().slice(-6);

  return {
    labelId: `LBL-${suffix}`,
    generatedAt,
    apotekName: APOTEK_NAME,
    patientName: input.patientName.trim(),
    medicineName: input.medicineName.trim(),
    dosage: input.dosage.trim(),
    duration: formatDuration(input.duration),
    instructions: input.instructions.trim(),
    barcode: `DRS-${suffix}`,
  };
}

export async function listPatientMedicineInfo(): Promise<DemoPatientMedicineInfo[]> {
  let stockItems = await listStockItems();
  if (stockItems.length === 0) {
    stockItems = await listStockItems({ includeCatalog: true });
  }

  const store = await readStore();
  const latestDispensingByMedicineNumber = mapLatestDispensingOrderByMedicineNumber(
    store.dispensingOrders,
  );

  const selected = stockItems.slice(0, 3);
  const defaultSchedules = [
    "1x1 sesudah sarapan",
    "2x1 sesudah makan",
    "3x1 sesudah makan",
  ];

  const patientGuides: Array<{
    tujuanTerapi: string;
    waktuKonsumsi: string[];
    peringatan: string;
    tipsPenyimpanan: string;
  }> = [
    {
      tujuanTerapi: "Membantu meredakan demam dan nyeri ringan agar aktivitas harian lebih nyaman.",
      waktuKonsumsi: ["Pagi sesudah sarapan", "Malam sesudah makan"],
      peringatan: "Jangan melebihi dosis harian tanpa arahan tenaga kesehatan.",
      tipsPenyimpanan: "Simpan di suhu ruang, jauhkan dari paparan panas langsung.",
    },
    {
      tujuanTerapi: "Membantu menangani infeksi bakteri sesuai resep dokter.",
      waktuKonsumsi: ["Pagi sesudah makan", "Sore sesudah makan"],
      peringatan: "Habiskan sesuai durasi terapi dan hindari berhenti mendadak.",
      tipsPenyimpanan: "Simpan di tempat kering, tertutup rapat, dan jauh dari jangkauan anak.",
    },
    {
      tujuanTerapi: "Mendukung kontrol tekanan darah agar tetap stabil setiap hari.",
      waktuKonsumsi: ["Pagi setelah sarapan"],
      peringatan: "Tetap konsumsi pada jam yang sama dan catat tekanan darah berkala.",
      tipsPenyimpanan: "Simpan pada blister asli agar kualitas obat tetap terjaga.",
    },
  ];

  const fallbackGuide = {
    tujuanTerapi: "Mendukung terapi pasien sesuai diagnosis dan evaluasi dokter.",
    waktuKonsumsi: ["Sesuai jadwal yang diberikan apoteker"],
    peringatan: "Ikuti aturan pakai pada etiket dan konsultasikan jika ada keluhan.",
    tipsPenyimpanan: "Simpan di tempat sejuk, kering, dan terlindung dari cahaya.",
  };

  return selected.map((item, index) => {
    const guide = patientGuides[index] ?? fallbackGuide;
    const normalizedNomorObat = (item.nomorObat ?? "").trim().toUpperCase();
    const relatedDispensing = normalizedNomorObat
      ? latestDispensingByMedicineNumber.get(normalizedNomorObat)
      : undefined;

    return {
      id: item.id,
      nomorObat: item.nomorObat,
      nomorPeresepan: relatedDispensing?.nomorPeresepan,
      nama: item.nama,
      aturan: defaultSchedules[index] ?? "1x1 sesuai anjuran",
      stokStatus:
        item.status === "kritis"
          ? "Stok kritis"
          : item.status === "menipis"
            ? "Stok terbatas"
            : "Tersedia",
      dispensingWorkflowStatus: relatedDispensing
        ? resolveDispensingWorkflowStatus(relatedDispensing)
        : undefined,
      dispensingUpdatedAt: relatedDispensing
        ? resolveDispensingEventTimestamp(relatedDispensing)
        : undefined,
      catatan:
        item.status === "kritis"
          ? "Hubungi apoteker untuk konfirmasi ketersediaan sebelum kunjungan."
          : "Ambil obat sesuai jadwal kontrol.",
      tujuanTerapi: guide.tujuanTerapi,
      waktuKonsumsi: guide.waktuKonsumsi,
      peringatan: guide.peringatan,
      tipsPenyimpanan: guide.tipsPenyimpanan,
    };
  });
}

function collectPatientRecordNumbersForReceivedMedicine(
  store: DemoWorkflowStore,
  options?: ListPatientReceivedMedicineInfoOptions,
): Set<string> {
  const recordNumbers = new Set<string>();
  const normalizedUserId = normalizeOptionalUserId(options?.patientUserId);
  const normalizedNomorRM = options?.patientNomorRM
    ? normalizeMedicalRecordSearchText(options.patientNomorRM)
    : "";
  const patientNameFilter = options?.patientName?.trim() ?? "";

  if (normalizedNomorRM) {
    recordNumbers.add(normalizedNomorRM);
  }

  if (normalizedUserId) {
    for (const patient of store.patients) {
      if (normalizeOptionalUserId(patient.userId) !== normalizedUserId) {
        continue;
      }

      const patientRecordNumber = normalizeMedicalRecordSearchText(patient.nomorRM);
      if (patientRecordNumber) {
        recordNumbers.add(patientRecordNumber);
      }
    }
  }

  if (recordNumbers.size === 0 && patientNameFilter.length > 0) {
    for (const patient of store.patients) {
      if (!matchesByComparisonText(patient.nama, patientNameFilter)) {
        continue;
      }

      const patientRecordNumber = normalizeMedicalRecordSearchText(patient.nomorRM);
      if (patientRecordNumber) {
        recordNumbers.add(patientRecordNumber);
      }
    }
  }

  return recordNumbers;
}

function isDispensingOrderVisibleForPatientReceivedMedicine(
  order: DemoDispensingOrder,
  patientRecordNumbers: Set<string>,
  patientNameFilter: string,
): boolean {
  if (patientRecordNumbers.size === 0 && patientNameFilter.length === 0) {
    return true;
  }

  const orderRecordNumber = normalizeMedicalRecordSearchText(order.nomorRM ?? "");
  if (orderRecordNumber && patientRecordNumbers.has(orderRecordNumber)) {
    return true;
  }

  if (patientNameFilter.length > 0 && matchesByComparisonText(order.patientName, patientNameFilter)) {
    return true;
  }

  return false;
}

function toPatientMedicineStockStatusLabel(status?: DemoStockItem["status"]): string {
  if (status === "kritis") {
    return "Stok kritis";
  }

  if (status === "menipis") {
    return "Stok terbatas";
  }

  return "Tersedia";
}

export async function listPatientReceivedMedicineInfo(
  options?: ListPatientReceivedMedicineInfoOptions,
): Promise<DemoPatientMedicineInfo[]> {
  const store = await readStore();
  const stockItems = await listStockItems({ includeCatalog: true });
  const nomorPeresepanFilter = options?.nomorPeresepan?.trim().toUpperCase() ?? "";
  const patientNameFilter = options?.patientName?.trim() ?? "";
  const patientRecordNumbers = collectPatientRecordNumbersForReceivedMedicine(store, options);

  const deliveredOrders = store.dispensingOrders
    .filter((order) => {
      if (resolveDispensingWorkflowStatus(order) !== "diserahkan") {
        return false;
      }

      const orderNomorPeresepan = (order.nomorPeresepan ?? "").trim().toUpperCase();
      if (nomorPeresepanFilter.length > 0 && orderNomorPeresepan !== nomorPeresepanFilter) {
        return false;
      }

      return isDispensingOrderVisibleForPatientReceivedMedicine(
        order,
        patientRecordNumbers,
        patientNameFilter,
      );
    })
    .sort((first, second) =>
      compareByDateDesc(
        resolveDispensingEventTimestamp(first),
        resolveDispensingEventTimestamp(second),
      ),
    );

  return deliveredOrders.map((order, index) => {
    const relatedStock = findStockItemByOrderInput(
      stockItems,
      order.nomorObat ?? "",
      order.medicineName,
    );

    return {
      id: `patient-received-${order.id}-${index + 1}`,
      nomorObat: order.nomorObat,
      nomorPeresepan: order.nomorPeresepan,
      nama: order.medicineName,
      aturan: order.dosage.trim().length > 0 ? order.dosage : "Sesuai etiket obat",
      stokStatus: toPatientMedicineStockStatusLabel(relatedStock?.status),
      dispensingWorkflowStatus: "diserahkan",
      dispensingUpdatedAt: resolveDispensingEventTimestamp(order),
      catatan: "Obat ini sudah diterima dari hasil dispensing oleh apoteker.",
      tujuanTerapi:
        "Gunakan obat sesuai instruksi dokter dan apoteker yang tertera pada etiket.",
      waktuKonsumsi: ["Ikuti jam minum sesuai etiket obat"],
      peringatan: "Jangan mengubah dosis tanpa konsultasi dengan tenaga kesehatan.",
      tipsPenyimpanan:
        "Simpan di tempat sejuk, kering, dan terhindar dari sinar matahari langsung.",
    };
  });
}

export async function listPatientMedicineInfoByPrescriptionNumber(
  nomorPeresepan: string,
): Promise<DemoPatientMedicineInfo[]> {
  const normalizedNumber = nomorPeresepan.trim().toUpperCase();
  if (!normalizedNumber) {
    return [];
  }

  const store = await readStore();
  const prescription = store.prescriptions.find(
    (item) => item.nomorPeresepan.toUpperCase() === normalizedNumber,
  );

  if (!prescription) {
    return [];
  }

  const stockItems = await listStockItems({ includeCatalog: true });
  const relatedOrders = store.dispensingOrders.filter(
    (order) => (order.nomorPeresepan ?? "").trim().toUpperCase() === normalizedNumber,
  );

  return prescription.items.map((item, index) => {
    const stock = stockItems.find(
      (stockItem) => (stockItem.nomorObat ?? "").toUpperCase() === item.nomorObat.toUpperCase(),
    );
    const relatedDispensing = findLatestDispensingOrderForPrescriptionItem(
      relatedOrders,
      item.nomorObat,
      item.medicineName,
    );

    const inferredStatus = stock?.status ?? "aman";
    const stokStatus =
      inferredStatus === "kritis"
        ? "Stok kritis"
        : inferredStatus === "menipis"
          ? "Stok terbatas"
          : "Tersedia";

    return {
      id: `${prescription.id}-${item.id}-${index + 1}`,
      nomorObat: item.nomorObat,
      nomorPeresepan: prescription.nomorPeresepan,
      nama: item.medicineName,
      aturan: item.dosis,
      stokStatus,
      dispensingWorkflowStatus: relatedDispensing
        ? resolveDispensingWorkflowStatus(relatedDispensing)
        : undefined,
      dispensingUpdatedAt: relatedDispensing
        ? resolveDispensingEventTimestamp(relatedDispensing)
        : undefined,
      catatan: `Data obat berdasarkan nomor peresepan ${prescription.nomorPeresepan}.`,
      tujuanTerapi: "Ikuti terapi sesuai evaluasi dokter dan verifikasi apoteker.",
      waktuKonsumsi: ["Sesuai aturan pakai pada etiket"],
      peringatan: "Hubungi tenaga kesehatan jika ada efek samping yang tidak diharapkan.",
      tipsPenyimpanan: "Simpan obat di tempat sejuk, kering, dan terhindar dari sinar matahari langsung.",
    };
  });
}

export interface ListMedicineTransactionsOptions {
  limit?: number;
  nomorObatQuery?: string;
  query?: string;
}

function toReadableTransactionNumber(transaction: DemoMedicineTransaction): string {
  const timestamp = new Date(transaction.occurredAt);
  const datePart = Number.isNaN(timestamp.getTime())
    ? "00000000"
    : `${timestamp.getFullYear()}${String(timestamp.getMonth() + 1).padStart(2, "0")}${String(
        timestamp.getDate(),
      ).padStart(2, "0")}`;

  const idPart =
    transaction.id.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(-6) || "000000";

  return `TRX-${datePart}-${idPart}`;
}

export async function listMedicineTransactions(
  options?: ListMedicineTransactionsOptions,
): Promise<DemoMedicineTransaction[]> {
  const store = await readStore();
  const nomorObatFilter = options?.nomorObatQuery?.trim().toUpperCase() ?? "";
  const query = options?.query?.trim().toUpperCase() ?? "";
  const limit =
    typeof options?.limit === "number" && Number.isFinite(options.limit)
      ? Math.max(1, Math.floor(options.limit))
      : undefined;

  let filtered = store.medicineTransactions;

  if (nomorObatFilter.length > 0) {
    filtered = filtered.filter((item) => item.nomorObat.toUpperCase().includes(nomorObatFilter));
  }

  if (query.length > 0) {
    filtered = filtered.filter((item) => {
      const referenceId = item.referenceId?.toUpperCase() ?? "";
      const note = item.note?.toUpperCase() ?? "";
      const transactionNumber = toReadableTransactionNumber(item);

      return (
        item.nomorObat.toUpperCase().includes(query) ||
        item.id.toUpperCase().includes(query) ||
        transactionNumber.includes(query) ||
        referenceId.includes(query) ||
        note.includes(query)
      );
    });
  }

  const sorted = [...filtered].sort((a, b) => compareByDateDesc(a.occurredAt, b.occurredAt));
  return typeof limit === "number" ? sorted.slice(0, limit) : sorted;
}

export async function listPatientRecords(): Promise<DemoPatientRecord[]> {
  const store = await readStore();
  return [...store.patients].sort((first, second) =>
    first.nama.localeCompare(second.nama, "id", { sensitivity: "base" }),
  );
}

export async function resetDispensingData(): Promise<ResetDispensingDataResult> {
  return withWriteLock(async () => {
    const store = await readStore();

    const deletedOrders = store.dispensingOrders.length;
    const deletedPrescriptions = store.prescriptions.length;
    const deletedPayments = store.cashierPayments.length;
    const deletedPatients = store.patients.length;
    const deletedTransactions = store.medicineTransactions.filter(
      (item) => item.referenceType === "dispensing",
    ).length;

    store.dispensingOrders = [];
    store.prescriptions = [];
    store.cashierPayments = [];
    store.patients = [];
    store.medicineTransactions = store.medicineTransactions.filter(
      (item) => item.referenceType !== "dispensing",
    );

    if (isDispensingPostgresActive()) {
      await clearDispensingPgSnapshot();
    }

    await writeStore(store);

    return {
      deletedOrders,
      deletedPrescriptions,
      deletedPayments,
      deletedPatients,
      deletedTransactions,
    };
  });
}

export async function listPatientPrescriptionPayments(
  options?: ListPatientPrescriptionPaymentsOptions,
): Promise<DemoPatientPaymentSummary[]> {
  const store = await readStore();
  const nomorPeresepanQuery = options?.nomorPeresepan?.trim().toUpperCase() ?? "";
  const dispensingByNomorPeresepan = buildDispensingProgressByPrescription(
    store.dispensingOrders,
  );

  const paymentByNomorPeresepan = new Map<string, DemoCashierPayment>();
  for (const payment of store.cashierPayments) {
    paymentByNomorPeresepan.set(payment.nomorPeresepan.toUpperCase(), payment);
  }

  return store.prescriptions
    .filter((prescription) => {
      if (!nomorPeresepanQuery) {
        return true;
      }

      return prescription.nomorPeresepan.toUpperCase() === nomorPeresepanQuery;
    })
    .map((prescription) => {
      const normalizedNomorPeresepan = prescription.nomorPeresepan.toUpperCase();
      const dispensing =
        dispensingByNomorPeresepan.get(normalizedNomorPeresepan) ?? [];

      const existingPayment = paymentByNomorPeresepan.get(
        normalizedNomorPeresepan,
      );

      if (existingPayment) {
        return buildPatientPaymentSummary(existingPayment, prescription, dispensing);
      }

      const estimatedTotalTagihan = estimatePrescriptionTotalTagihan(prescription);
      return buildPatientPaymentSummary(
        {
          id: `pay-virtual-${prescription.id}`,
          nomorPeresepan: prescription.nomorPeresepan,
          statusBayar: "menunggu_bayar",
          totalTagihan: estimatedTotalTagihan,
          totalDibayar: 0,
          updatedAt: prescription.updatedAt,
        },
        prescription,
        dispensing,
      );
    })
    .sort((first, second) => compareByDateDesc(first.updatedAt, second.updatedAt));
}

export async function confirmPatientPrescriptionPayment(
  input: ConfirmPatientPaymentInput,
): Promise<ConfirmPatientPaymentResult> {
  return withWriteLock(async () => {
    const store = await readStore();
    const now = new Date().toISOString();
    const normalizedNomorPeresepan = input.nomorPeresepan.trim().toUpperCase();

    if (!normalizedNomorPeresepan) {
      throw new Error("Nomor peresepan wajib diisi.");
    }

    const prescription = store.prescriptions.find(
      (item) => item.nomorPeresepan.toUpperCase() === normalizedNomorPeresepan,
    );

    if (!prescription) {
      throw new Error(
        `Nomor peresepan ${normalizedNomorPeresepan} tidak ditemukan pada data resep dokter.`,
      );
    }

    let payment = store.cashierPayments.find(
      (item) => item.nomorPeresepan.toUpperCase() === normalizedNomorPeresepan,
    );

    if (!payment) {
      payment = {
        id: `pay-${randomUUID().slice(0, 8)}`,
        nomorPeresepan: prescription.nomorPeresepan,
        statusBayar: "menunggu_bayar",
        totalTagihan: estimatePrescriptionTotalTagihan(prescription),
        totalDibayar: 0,
        updatedAt: now,
      };
      store.cashierPayments.push(payment);
    }

    const wasLunas = normalizePaymentStatus(payment.statusBayar, "menunggu_bayar") === "lunas";

    const selectedMethod = normalizePaymentMethod(
      input.metodeBayar,
      payment.metodeBayar ?? "cash",
    );

    payment.statusBayar = "lunas";
    payment.totalTagihan = Math.max(
      0,
      Math.round(payment.totalTagihan),
      estimatePrescriptionTotalTagihan(prescription),
    );
    payment.totalDibayar = Math.max(0, Math.round(payment.totalDibayar), payment.totalTagihan);
    payment.metodeBayar = selectedMethod;
    payment.paidAt = now;
    payment.updatedAt = now;

    let relatedOrderCount = 0;
    const dispensing: ConfirmPatientPaymentDispensingInfo[] = [];
    for (const order of store.dispensingOrders) {
      const orderNomorPeresepan = (order.nomorPeresepan ?? "").trim().toUpperCase();
      if (!orderNomorPeresepan || orderNomorPeresepan !== normalizedNomorPeresepan) {
        continue;
      }

      relatedOrderCount += 1;

      const previousPaymentStatus = normalizePaymentStatus(
        order.paymentStatus,
        inferPaymentStatusFromLegacyStatus(order.status),
      );

      order.paymentStatus = "lunas";
      const currentWorkflowStatus = resolveDispensingWorkflowStatus(order);
      if (
        currentWorkflowStatus === "menunggu_pembayaran" ||
        currentWorkflowStatus === "menunggu_validasi_resep"
      ) {
        order.workflowStatus = "siap_diracik";
      }
      order.updatedAt = now;

      dispensing.push(buildPatientDispensingProgress(order));
    }

    await writeStore(store);

    return {
      payment: buildPatientPaymentSummary(payment, prescription, dispensing),
      updated: !wasLunas,
      relatedOrderCount,
      dispensing,
    };
  });
}

function buildStarterReminders(userId: string): DemoReminder[] {
  return [
    {
      id: `rem-starter-${userId}-1`,
      userId,
      title: "Kontrol hipertensi",
      date: "2026-04-20",
      time: "08:00",
      channel: "aplikasi",
      note: "Pengingat awal otomatis untuk alur demo.",
      createdAt: "2026-04-07T08:00:00.000Z",
    },
    {
      id: `rem-starter-${userId}-2`,
      userId,
      title: "Evaluasi gula darah",
      date: "2026-04-30",
      time: "18:30",
      channel: "email",
      note: "Silakan bawa hasil lab terakhir saat kontrol.",
      createdAt: "2026-04-07T08:05:00.000Z",
    },
  ];
}

export async function listRemindersByUser(userId: string): Promise<DemoReminder[]> {
  const store = await readStore();
  const reminders = store.reminders
    .filter((item) => item.userId === userId)
    .sort((a, b) => compareByDateDesc(a.createdAt, b.createdAt));

  if (reminders.length > 0) {
    return reminders;
  }

  return buildStarterReminders(userId);
}

export async function createReminder(input: CreateReminderInput): Promise<DemoReminder> {
  return withWriteLock(async () => {
    const store = await readStore();

    const reminder: DemoReminder = {
      id: `rem-${randomUUID().slice(0, 8)}`,
      userId: input.userId,
      title: input.title.trim(),
      date: input.date,
      time: normalizeReminderTime(input.time),
      channel: input.channel,
      note: input.note.trim(),
      createdAt: new Date().toISOString(),
    };

    store.reminders.push(reminder);
    await writeStore(store);

    return reminder;
  });
}

export function checkInsurance(input: InsuranceCheckInput): DemoInsuranceResult {
  const normalizedMember = input.memberId.trim();
  const normalizedService = input.serviceType.trim();
  const hasValidMember = normalizedMember.length >= 8;
  const checkedAt = new Date().toISOString();

  if (input.provider === "bpjs") {
    const approved = hasValidMember;
    return {
      provider: "bpjs",
      memberId: normalizedMember,
      serviceType: normalizedService,
      approved,
      estimatedCoveragePercent: approved ? 90 : 0,
      coverage: approved
        ? "Ditanggung BPJS sesuai formularium dan kelas layanan."
        : "Nomor peserta tidak valid untuk simulasi BPJS.",
      note: approved
        ? "Verifikasi akhir tetap dilakukan oleh petugas administrasi rumah sakit."
        : "Periksa kembali nomor peserta atau status kepesertaan.",
      checkedAt,
    };
  }

  const approved = hasValidMember;

  return {
    provider: "swasta",
    memberId: normalizedMember,
    serviceType: normalizedService,
    approved,
    estimatedCoveragePercent: approved ? 75 : 0,
    coverage: approved
      ? "Ditanggung parsial sesuai polis asuransi swasta."
      : "Data polis tidak ditemukan pada simulasi.",
    note: approved
      ? "Persentase final bergantung plafon dan manfaat obat pada polis."
      : "Silakan konfirmasi nomor polis ke bagian administrasi.",
    checkedAt,
  };
}