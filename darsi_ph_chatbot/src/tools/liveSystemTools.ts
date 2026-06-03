import path from "node:path";
import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { createTool } from "@voltagent/core";
import { z } from "zod";
import { getPgPool, qualifyTable, resolvePgConfig, resolveSchema, sanitizeIdentifier } from "../utils/darsiDb.js";

type LiveFocus = "auto" | "semua" | "stok" | "dispensing" | "pembayaran";
type LiveViewerRole = "auto" | "apoteker" | "admin" | "pasien";
type LiveDbMode = "libsql" | "postgres";

type LiveDbClient = {
  mode: LiveDbMode;
  schema?: string;
  execute: (params: { sql: string; args?: unknown[] }) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type LiveSystemHealthSummary = {
  ok: boolean;
  checkedAt: string;
  dbTarget: string;
  pingMs: number;
  tables: {
    stock: boolean;
    dispensing: boolean;
  };
  rowCounts: {
    stock: number;
    dispensing: number;
  };
};

type StockSummary = {
  totalItems: number;
  totalUnits: number;
  amanCount: number;
  menipisCount: number;
  kritisCount: number;
  lowStockItems: Array<{
    nomorObat: string;
    nama: string;
    stok: number;
    status: string;
  }>;
};

type DispensingSummary = {
  totalOrders: number;
  menungguValidasiResepCount: number;
  menungguPembayaranWorkflowCount: number;
  siapDiracikCount: number;
  sedangDiracikCount: number;
  siapDiserahkanCount: number;
  diserahkanCount: number;

  cancelCount: number;
  belumDiserahkanCount: number;
  menungguPembayaranCount: number;
  lunasCount: number;
  gagalCount: number;
  dibatalkanCount: number;
  refundCount: number;
  inProgressItems: Array<{
    id: string;
    patientName: string;
    medicineName: string;
    nomorObat: string;
    workflowStatus: string;
    paymentStatus: string;
  }>;
  pendingPaymentItems: Array<{
    id: string;
    patientName: string;
    medicineName: string;
    nomorPeresepan: string;
    paymentStatus: string;
  }>;
  recentTransactions: Array<{
    id: string;
    patientName: string;
    medicineName: string;
    nomorPeresepan: string;
    workflowStatus: string;
    paymentStatus: string;
    createdAt: string;
  }>;
};

type ForecastRiskLevel = "kritis" | "tinggi" | "waspada" | "stabil" | "belum_terukur";
type ForecastConfidenceLevel = "rendah" | "sedang" | "tinggi";

type StockForecastItem = {
  nomorObat: string;
  nama: string;
  stokSaatIni: number;
  sampleOrderCount: number;
  observedDays: number;
  avgDemandPerDay: number;
  projectedDemandQty: number;
  estimatedDaysToStockout: number | null;
  recommendedReorderQty: number;
  riskLevel: ForecastRiskLevel;
  confidence: ForecastConfidenceLevel;
};

type StockForecastSummary = {
  horizonDays: number;
  totalItems: number;
  totalProjectedDemandQty: number;
  totalRecommendedReorderQty: number;
  urgentCount: number;
  warningCount: number;
  needsReorderCount: number;
  avgDemandTotalPerDay: number;
  items: StockForecastItem[];
};

type NormalizedPaymentStatus = "menunggu_bayar" | "lunas" | "gagal" | "dibatalkan" | "refund";
type NormalizedWorkflowStatus =
  | "menunggu_validasi_resep"
  | "menunggu_pembayaran"
  | "siap_diracik"
  | "sedang_diracik"
  | "siap_diserahkan"
  | "diserahkan"
  | "cancel";

type StockItemRecord = {
  id: string;
  nomorObat: string;
  nama: string;
  stok: number;
  status: "aman" | "menipis" | "kritis";
};

type DispensingRecord = {
  id: string;
  patientName: string;
  medicineName: string;
  nomorObat: string;
  nomorPeresepan: string;
  quantity: number;
  rawStatus: string;
  rawWorkflowStatus: string;
  rawPaymentStatus: string;
  createdAt: string;
};

type FallbackStoreShape = {
  stockItems?: unknown;
  dispensingOrders?: unknown;
};

const FALLBACK_WORKFLOW_STORE_FILE = path.join(process.cwd(), "ui", "data", "demo-workflows.json");

const ACTIVE_WORKFLOW_STATUSES = new Set<NormalizedWorkflowStatus>([
  "menunggu_validasi_resep",
  "menunggu_pembayaran",
  "siap_diracik",
  "sedang_diracik",
  "siap_diserahkan",
]);

const KNOWN_WORKFLOW_STATUSES = new Set<NormalizedWorkflowStatus>([
  "menunggu_validasi_resep",
  "menunggu_pembayaran",
  "siap_diracik",
  "sedang_diracik",
  "siap_diserahkan",
  "diserahkan",
  "cancel",
]);

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const FORECAST_MIN_HORIZON_DAYS = 3;
const FORECAST_MAX_HORIZON_DAYS = 90;
const FORECAST_DEFAULT_HORIZON_DAYS = 14;
const FORECAST_DEFAULT_TOP_K = 5;
const FORECAST_MIN_TOP_K = 3;
const FORECAST_MAX_TOP_K = 10;
const FORECAST_SAFETY_DAYS = 7;

const numberFormatterCache = new Map<number, Intl.NumberFormat>();

let cachedFallbackStorePromise: Promise<FallbackStoreShape | null> | null = null;

function extractString(val: unknown): string {
  if (typeof val === "string") return val;
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (typeof obj.value === "string") return obj.value;
    if (typeof obj.query === "string") return obj.query;
    if (obj.description && !obj.value && !obj.query) return "";
  }
  return String(val ?? "");
}

function parseInteger(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const WORKFLOWS_SCHEMA = resolveSchema("DARSI_WORKFLOWS_DB_SCHEMA", "darsi_ph_workflows");

function resolveLiveDbUrl(): string {
  const explicit = process.env.DARSI_LIVE_DB_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const dedicated = process.env.DEMO_LIBSQL_DATABASE_URL?.trim();
  if (dedicated) {
    return dedicated;
  }

  const shared = process.env.LIBSQL_DATABASE_URL?.trim();
  if (shared) {
    return shared;
  }

  return `file:${path.join(process.cwd(), "ui", "data", "demo-workflows.db")}`;
}

function resolveLiveDbToken(): string | undefined {
  const explicit = process.env.DARSI_LIVE_DB_AUTH_TOKEN?.trim();
  if (explicit) {
    return explicit;
  }

  const dedicated = process.env.DEMO_LIBSQL_AUTH_TOKEN?.trim();
  if (dedicated) {
    return dedicated;
  }

  const shared = process.env.LIBSQL_AUTH_TOKEN?.trim();
  return shared || undefined;
}

function sanitizeDbTarget(url: string): string {
  if (url.startsWith("file:")) {
    return url;
  }

  // Hide credentials from non-file connection strings.
  return url.replace(/:\/\/([^:\/?#]+):[^@/]+@/g, "://$1:***@");
}
function isPostgresLiveDb(): boolean {
  return resolvePgConfig("DARSI_WORKFLOWS_DB") !== null;
}

function buildLiveDbTarget(client: LiveDbClient): string {
  if (client.mode === "postgres") {
    const config = resolvePgConfig("DARSI_WORKFLOWS_DB");
    if (config?.connectionString) {
      return config.connectionString.replace(/:\/\/([^:\/?#]+):[^@/]+@/g, "://$1:***@");
    }

    if (config?.host) {
      return `postgres://${config.host}:${config.port ?? 5432}/${config.database ?? "hospital_cs"}`;
    }

    return "postgres://configured";
  }

  return sanitizeDbTarget(resolveLiveDbUrl());
}

function convertSqlPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

let cachedClient: LiveDbClient | null = null;

function getClient(): LiveDbClient {
  if (cachedClient) {
    return cachedClient;
  }

  if (isPostgresLiveDb()) {
    const pool = getPgPool("DARSI_WORKFLOWS_DB");
    if (pool) {
      cachedClient = {
        mode: "postgres",
        schema: WORKFLOWS_SCHEMA,
        execute: async ({ sql, args }) => {
          const converted = convertSqlPlaceholders(sql);
          const result = await pool.query(converted, args ?? []);
          return { rows: result.rows as Array<Record<string, unknown>> };
        },
      };
      return cachedClient;
    }
  }

  const url = resolveLiveDbUrl();
  const authToken = resolveLiveDbToken();
  const libsqlClient = createClient({
    url,
    ...(authToken ? { authToken } : {}),
  });
  cachedClient = {
    mode: "libsql",
    execute: async (params) => {
      const result = await libsqlClient.execute(params);
      return { rows: result.rows as Array<Record<string, unknown>> };
    },
  };

  return cachedClient;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function toStringValue(value: unknown, fallback = "-"): string {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : fallback;
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  return fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function normalizeMedicineRoot(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b\d+(?:mg|mcg|g|ml|iu)?\b/g, " ")
    .replace(/\b(tablet|tab|kapsul|capsule|kaplet|sirup|syrup|drop|injeksi|ampul)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseIsoDateToEpoch(dateValue: string): number | null {
  const parsed = Date.parse(dateValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseForecastHorizonFromQuery(query: string): number | null {
  const normalized = query.toLowerCase();
  const match = normalized.match(
    /(\d{1,3})\s*(hari|hr|hri|day|days|minggu|pekan|week|weeks|bulan|month|months)\b/,
  );

  if (match) {
    const amount = Number.parseInt(match[1] ?? "", 10);
    const unit = match[2] ?? "hari";

    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }

    if (unit.startsWith("minggu") || unit.startsWith("pekan") || unit.startsWith("week")) {
      return amount * 7;
    }

    if (unit.startsWith("bulan") || unit.startsWith("month")) {
      return amount * 30;
    }

    return amount;
  }

  if (/\bbulan depan\b/.test(normalized)) {
    return 30;
  }

  if (/\bminggu depan\b/.test(normalized)) {
    return 7;
  }

  return null;
}

function resolveForecastHorizonDays(query: string, requested?: number): number {
  const explicit = typeof requested === "number" ? requested : Number.NaN;
  const parsedFromQuery = parseForecastHorizonFromQuery(query);
  const candidate = Number.isFinite(explicit) ? explicit : parsedFromQuery ?? FORECAST_DEFAULT_HORIZON_DAYS;
  return Math.round(clampNumber(candidate, FORECAST_MIN_HORIZON_DAYS, FORECAST_MAX_HORIZON_DAYS));
}

function resolveForecastTopK(requested?: number): number {
  const candidate = typeof requested === "number" ? requested : FORECAST_DEFAULT_TOP_K;
  return Math.round(clampNumber(candidate, FORECAST_MIN_TOP_K, FORECAST_MAX_TOP_K));
}

function extractForecastKeywords(rawQuery: string): string[] {
  const keywords = extractOperationalTokens(rawQuery);
  if (!rawQuery.trim()) {
    return keywords;
  }

  const numberTokensForHorizon = Array.from(
    rawQuery
      .toLowerCase()
      .matchAll(/(\d{1,3})\s*(hari|hr|hri|day|days|minggu|pekan|week|weeks|bulan|month|months)\b/g),
  ).map((match) => match[1] ?? "");

  if (numberTokensForHorizon.length === 0) {
    return keywords;
  }

  const excludedNumberTokens = new Set(numberTokensForHorizon);
  return keywords.filter((token) => !excludedNumberTokens.has(token));
}

function inferStockStatusByQuantity(stock: number): "aman" | "menipis" | "kritis" {
  if (stock <= 5) {
    return "kritis";
  }

  if (stock <= 20) {
    return "menipis";
  }

  return "aman";
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

function normalizePrescriptionNumber(raw: unknown, fallbackId: string, createdAt: string): string {
  if (typeof raw === "string") {
    const trimmed = raw.trim().toUpperCase();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  const createdDatePrefix = createdAt.slice(0, 10).replace(/-/g, "");
  const datePrefix = createdDatePrefix.length === 8 ? createdDatePrefix : "00000000";
  const idSuffix = fallbackId.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase();
  return `RSP-${datePrefix}-${idSuffix || "000000"}`;
}

function inferPaymentStatusFromLegacyStatus(rawStatus: string): NormalizedPaymentStatus {
  if (rawStatus === "selesai") {
    return "lunas";
  }

  return "menunggu_bayar";
}

function normalizePaymentStatus(
  raw: unknown,
  fallback: NormalizedPaymentStatus,
): NormalizedPaymentStatus {
  const normalized = toStringValue(raw, "").toLowerCase();
  if (
    normalized === "menunggu_bayar" ||
    normalized === "lunas" ||
    normalized === "gagal" ||
    normalized === "dibatalkan" ||
    normalized === "refund"
  ) {
    return normalized;
  }

  return fallback;
}

function inferWorkflowStatus(
  rawStatus: string,
  paymentStatus: NormalizedPaymentStatus,
): NormalizedWorkflowStatus {
  if (paymentStatus === "dibatalkan" || paymentStatus === "gagal" || paymentStatus === "refund") {
    return "cancel";
  }

  if (paymentStatus === "menunggu_bayar") {
    return "menunggu_pembayaran";
  }

  if (rawStatus === "selesai") {
    return "diserahkan";
  }

  if (rawStatus === "siap_diserahkan") {
    return "siap_diserahkan";
  }

  if (rawStatus === "diracik") {
    return "sedang_diracik";
  }

  return "siap_diracik";
}

function reconcileWorkflowWithPayment(
  workflowStatus: NormalizedWorkflowStatus,
  paymentStatus: NormalizedPaymentStatus,
): NormalizedWorkflowStatus {
  if (paymentStatus === "dibatalkan" || paymentStatus === "gagal" || paymentStatus === "refund") {
    return "cancel";
  }

  if (paymentStatus === "menunggu_bayar") {
    return workflowStatus === "menunggu_validasi_resep"
      ? "menunggu_validasi_resep"
      : "menunggu_pembayaran";
  }

  return workflowStatus;
}

function resolveWorkflowStatus(
  rawWorkflowStatus: unknown,
  rawStatus: unknown,
  paymentStatus: NormalizedPaymentStatus,
): NormalizedWorkflowStatus {
  const normalizedWorkflow = toStringValue(rawWorkflowStatus, "").toLowerCase() as NormalizedWorkflowStatus;
  if (KNOWN_WORKFLOW_STATUSES.has(normalizedWorkflow)) {
    return reconcileWorkflowWithPayment(normalizedWorkflow, paymentStatus);
  }

  const normalizedStatus = toStringValue(rawStatus, "diterima").toLowerCase();
  return inferWorkflowStatus(normalizedStatus, paymentStatus);
}

function matchesAllKeywords(keywords: string[], values: string[]): boolean {
  if (keywords.length === 0) {
    return true;
  }

  const haystack = values
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
    .join(" ");

  return keywords.every((keyword) => haystack.includes(keyword.toUpperCase()));
}

async function readFallbackStoreData(): Promise<FallbackStoreShape | null> {
  if (!cachedFallbackStorePromise) {
    cachedFallbackStorePromise = readFile(FALLBACK_WORKFLOW_STORE_FILE, "utf8")
      .then((raw) => JSON.parse(raw) as FallbackStoreShape)
      .catch(() => null);
  }

  return cachedFallbackStorePromise;
}

async function loadFallbackStockRows(keywords: string[]): Promise<StockItemRecord[]> {
  const fallbackStore = await readFallbackStoreData();
  if (!fallbackStore || !Array.isArray(fallbackStore.stockItems)) {
    return [];
  }

  const fallbackRows: StockItemRecord[] = [];

  for (let index = 0; index < fallbackStore.stockItems.length; index += 1) {
    const rawItem = fallbackStore.stockItems[index];
    if (!rawItem || typeof rawItem !== "object") {
      continue;
    }

    const candidate = rawItem as Record<string, unknown>;
    const nama = toStringValue(candidate.nama, "");
    if (!nama) {
      continue;
    }

    const id = toStringValue(candidate.id, `stk-${index + 1}`);
    const stok = Math.max(0, Math.round(toNumber(candidate.stok, 0)));
    const nomorObat = normalizeMedicineNumber(candidate.nomorObat, id, index + 1);

    if (!matchesAllKeywords(keywords, [nama, nomorObat])) {
      continue;
    }

    fallbackRows.push({
      id,
      nomorObat,
      nama,
      stok,
      status: inferStockStatusByQuantity(stok),
    });
  }

  return fallbackRows;
}

async function loadFallbackDispensingRows(keywords: string[]): Promise<DispensingRecord[]> {
  const fallbackStore = await readFallbackStoreData();
  if (!fallbackStore || !Array.isArray(fallbackStore.dispensingOrders)) {
    return [];
  }

  const fallbackRows: DispensingRecord[] = [];

  for (let index = 0; index < fallbackStore.dispensingOrders.length; index += 1) {
    const rawItem = fallbackStore.dispensingOrders[index];
    if (!rawItem || typeof rawItem !== "object") {
      continue;
    }

    const candidate = rawItem as Record<string, unknown>;
    const id = toStringValue(candidate.id, `dsp-${index + 1}`);
    const patientName = toStringValue(candidate.patientName, "-");
    const medicineName = toStringValue(candidate.medicineName, "-");
    const createdAt = toStringValue(candidate.createdAt, new Date().toISOString());
    const nomorObat = normalizeMedicineNumber(candidate.nomorObat, id, index + 1);
    const nomorPeresepan = normalizePrescriptionNumber(candidate.nomorPeresepan, id, createdAt);
    const quantity = Math.max(1, Math.round(toNumber(candidate.quantity, 1)));

    if (!matchesAllKeywords(keywords, [medicineName, nomorObat, patientName, nomorPeresepan])) {
      continue;
    }

    fallbackRows.push({
      id,
      patientName,
      medicineName,
      nomorObat,
      nomorPeresepan,
      quantity,
      rawStatus: toStringValue(candidate.status, "diterima").toLowerCase(),
      rawWorkflowStatus: toStringValue(candidate.workflowStatus, "").toLowerCase(),
      rawPaymentStatus: toStringValue(candidate.paymentStatus, "").toLowerCase(),
      createdAt,
    });
  }

  return fallbackRows.sort((a, b) => {
    const left = Date.parse(a.createdAt);
    const right = Date.parse(b.createdAt);
    if (Number.isFinite(left) && Number.isFinite(right) && left !== right) {
      return right - left;
    }

    return b.createdAt.localeCompare(a.createdAt);
  });
}

function qualifyTableName(client: LiveDbClient, tableName: string): string {
  if (client.mode === "postgres") {
    const schema = client.schema || WORKFLOWS_SCHEMA;
    const safeSchema = sanitizeIdentifier(schema, "public");
    const safeTable = sanitizeIdentifier(tableName, tableName);
    return qualifyTable(safeSchema, safeTable);
  }

  return tableName;
}

async function tableExists(client: LiveDbClient, tableName: string): Promise<boolean> {
  if (client.mode === "postgres") {
    const schema = sanitizeIdentifier(client.schema || WORKFLOWS_SCHEMA, "public");
    const result = await client.execute({
      sql: "SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = ? AND table_name = ? LIMIT 1",
      args: [schema, tableName],
    });
    return result.rows.length > 0;
  }

  const result = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    args: [tableName],
  });

  return result.rows.length > 0;
}

const OPERATIONAL_QUERY_STOPWORDS = new Set([
  "status",
  "stok",
  "stock",
  "persediaan",
  "obat",
  "yang",
  "sedang",
  "proses",
  "di",
  "dan",
  "penyerahan",
  "serah",
  "serahkan",
  "diserahkan",
  "belum",
  "menunggu",
  "bayar",
  "pembayaran",
  "lunas",
  "pasien",
  "monitoring",
  "progres",
  "operasional",
  "kondisi",
  "ringkasan",
  "laporan",
  "sistem",
  "apotek",
  "apoteker",
  "tolong",
  "bantu",
  "bantuan",
  "butuh",
  "aku",
  "saya",
  "kami",
  "kita",
  "cek",
  "cari",
  "lihat",
  "tampilkan",
  "tampilin",
  "kasih",
  "berikan",
  "mohon",
  "data",
  "detail",
  "berapa",
  "bagaimana",
  "ada",
  "kah",
  "dong",
  "nya",
  "info",
  "informasi",
  "untuk",
  "proses",
  "live",
  "saat",
  "ini",
  "real",
  "realtime",
  "time",
  "sekarang",
  "terbaru",
  "berlangsung",
  "hari",
  "harian",
  "workflow",
  "dispensing",
  "transaksi",
  "riwayat",
  "aktivitas",
  "aktifitas",
  "layanan",
  "service",
  "resep",
  "antrian",
  "order",
  "racik",
  "diracik",
  "apa",
  "prediksi",
  "forecast",
  "forcasting",
  "proyeksi",
  "estimasi",
  "perkiraan",
  "kebutuhan",
  "restock",
  "reorder",
  "buffer",
  "stockout",
  "habis",
  "hari",
  "minggu",
  "bulan",
  "validasi",
  "angka",
  "admin",
  "mode",
  "pengguna",
]);

const OPERATIONAL_FOCUS_TERMS = {
  stok: new Set([
    "stok",
    "stock",
    "persediaan",
    "gudang",
    "monitoring",
    "ketersediaan",
    "tersedia",
    "sisa",
    "jumlah",
    "availability",
  ]),
  pembayaran: new Set([
    "bayar",
    "dibayar",
    "pembayaran",
    "lunas",
    "tagihan",
    "kasir",
    "menunggu",
    "transaksi",
    "billing",
    "invoice",
  ]),
  dispensing: new Set([
    "racik",
    "diracik",
    "racikan",
    "dispensing",
    "serah",
    "serahkan",
    "diserahkan",
    "transaksi",
    "riwayat",
    "aktivitas",
    "aktifitas",
    "layanan",
    "pelayanan",
    "pasien",
    "apoteker",
    "admin",
    "workflow",
    "resep",
    "peresepan",
  ]),
};

const OPERATIONAL_TOKEN_ALIASES: Record<string, string> = {
  stcok: "stock",
  stokk: "stok",
  stoq: "stok",
  diraciq: "diracik",
  diracikk: "diracik",
  dirakik: "diracik",
  disrahkan: "diserahkan",
  disrahin: "diserahkan",
  diserhakan: "diserahkan",
  diserahakn: "diserahkan",
  serahin: "serahkan",
  nyerahin: "serahkan",
  pembayran: "pembayaran",
  pembayarann: "pembayaran",
  transasksi: "transaksi",
  transkasi: "transaksi",
  riwayatt: "riwayat",
  aktifitas: "aktivitas",
  layananan: "layanan",
  realtimee: "realtime",
  menuggu: "menunggu",
  menunggu: "menunggu",
  monitroing: "monitoring",
  monitring: "monitoring",
};

const OPERATIONAL_CANONICAL_TOKENS = Array.from(
  new Set<string>([
    ...Array.from(OPERATIONAL_QUERY_STOPWORDS),
    ...Array.from(OPERATIONAL_FOCUS_TERMS.stok),
    ...Array.from(OPERATIONAL_FOCUS_TERMS.pembayaran),
    ...Array.from(OPERATIONAL_FOCUS_TERMS.dispensing),
  ]),
);

function levenshteinDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  const matrix: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  );

  for (let i = 0; i <= a.length; i += 1) {
    matrix[i]![0] = i;
  }

  for (let j = 0; j <= b.length; j += 1) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      const deletion = (matrix[i - 1]?.[j] ?? Number.POSITIVE_INFINITY) + 1;
      const insertion = (matrix[i]?.[j - 1] ?? Number.POSITIVE_INFINITY) + 1;
      const substitution = (matrix[i - 1]?.[j - 1] ?? Number.POSITIVE_INFINITY) + substitutionCost;
      matrix[i]![j] = Math.min(deletion, insertion, substitution);
    }
  }

  return matrix[a.length]?.[b.length] ?? Math.max(a.length, b.length);
}

function normalizeOperationalToken(rawToken: string): string {
  const token = rawToken.trim();
  if (!token) {
    return "";
  }

  if (/^[0-9]+$/.test(token)) {
    return token;
  }

  const aliased = OPERATIONAL_TOKEN_ALIASES[token];
  if (aliased) {
    return aliased;
  }

  if (token.length < 3) {
    return token;
  }

  const threshold = token.length >= 8 ? 2 : 1;
  let bestCandidate = token;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of OPERATIONAL_CANONICAL_TOKENS) {
    if (Math.abs(candidate.length - token.length) > threshold) {
      continue;
    }

    const distance = levenshteinDistance(token, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestCandidate = candidate;
      if (distance === 0) {
        break;
      }
    }
  }

  return bestDistance <= threshold ? bestCandidate : token;
}

function tokenizeOperationalQuery(rawQuery: string): string[] {
  if (!rawQuery.trim()) {
    return [];
  }

  const normalized = rawQuery
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return [];
  }

  const tokens = normalized.split(" ").filter(Boolean).map(normalizeOperationalToken).filter(Boolean);
  return Array.from(new Set(tokens));
}

function extractOperationalTokens(rawQuery: string): string[] {
  const rawTokens = tokenizeOperationalQuery(rawQuery);
  const filtered = rawTokens.filter((token) => {
    if (OPERATIONAL_QUERY_STOPWORDS.has(token)) {
      return false;
    }

    if (/^[0-9]+$/.test(token)) {
      return true;
    }

    return token.length >= 2;
  });

  return Array.from(new Set(filtered));
}

function inferFocusFromQuery(query: string): LiveFocus | null {
  const tokens = tokenizeOperationalQuery(query);

  const hasStockTerms = tokens.some((token) => OPERATIONAL_FOCUS_TERMS.stok.has(token));
  const hasPaymentTerms = tokens.some((token) => OPERATIONAL_FOCUS_TERMS.pembayaran.has(token));
  const hasDispensingTerms = tokens.some((token) => OPERATIONAL_FOCUS_TERMS.dispensing.has(token));

  const matchedFocusCount = [hasStockTerms, hasPaymentTerms, hasDispensingTerms].filter(Boolean).length;
  if (matchedFocusCount >= 2) {
    return "semua";
  }

  if (hasStockTerms) {
    return "stok";
  }

  if (hasPaymentTerms) {
    return "pembayaran";
  }

  if (hasDispensingTerms) {
    return "dispensing";
  }

  return null;
}

type LikeFilter = { clause: string; args: string[] };

function buildLikeFilter(columns: string[], keywords: string[]): LikeFilter {
  if (keywords.length === 0) {
    return { clause: "", args: [] };
  }

  const groupedClauses: string[] = [];
  const args: string[] = [];

  for (const keyword of keywords) {
    const pattern = `%${keyword.toUpperCase()}%`;
    groupedClauses.push(`(${columns.map((column) => `UPPER(${column}) LIKE ?`).join(" OR ")})`);
    for (let index = 0; index < columns.length; index += 1) {
      args.push(pattern);
    }
  }

  return {
    clause: `WHERE ${groupedClauses.join(" AND ")}`,
    args,
  };
}

function appendCondition(filterClause: string, condition: string): string {
  if (!filterClause) {
    return `WHERE ${condition}`;
  }

  return `${filterClause} AND ${condition}`;
}

function resolveFocus(query: string, requested?: LiveFocus): LiveFocus {
  if (requested && requested !== "auto") {
    return requested;
  }

  return inferFocusFromQuery(query) ?? "semua";
}

function resolveViewerRole(requested?: LiveViewerRole): Exclude<LiveViewerRole, "auto"> {
  if (requested === "admin") {
    return "admin";
  }

  if (requested === "pasien") {
    return "pasien";
  }

  return "apoteker";
}

function resolveFocusByRole(
  query: string,
  requested: LiveFocus,
  viewerRole: Exclude<LiveViewerRole, "auto">,
): LiveFocus {
  if (requested && requested !== "auto") {
    return requested;
  }

  const inferred = inferFocusFromQuery(query);
  if (inferred) {
    return inferred;
  }

  if (viewerRole === "apoteker") {
    // Default apoteker view prioritizes active operational queue.
    return "dispensing";
  }

  if (viewerRole === "pasien") {
    // Patient view is broader so user can ask stock/payment progress in one shot.
    return "semua";
  }

  return "semua";
}

async function fetchStockSummary(client: LiveDbClient, keywords: string[]): Promise<StockSummary> {
  const sourceRows = await loadStockRows(client, keywords);

  const totalItems = sourceRows.length;
  const totalUnits = sourceRows.reduce((acc, row) => acc + row.stok, 0);
  const amanCount = sourceRows.filter((row) => row.status === "aman").length;
  const menipisCount = sourceRows.filter((row) => row.status === "menipis").length;
  const kritisCount = sourceRows.filter((row) => row.status === "kritis").length;

  const lowStockItems = sourceRows
    .filter((row) => row.status === "kritis" || row.status === "menipis")
    .sort((left, right) => {
      const statusRank = (status: "aman" | "menipis" | "kritis"): number => {
        if (status === "kritis") {
          return 0;
        }

        if (status === "menipis") {
          return 1;
        }

        return 2;
      };

      const rankDiff = statusRank(left.status) - statusRank(right.status);
      if (rankDiff !== 0) {
        return rankDiff;
      }

      if (left.stok !== right.stok) {
        return left.stok - right.stok;
      }

      return left.nama.localeCompare(right.nama);
    })
    .slice(0, 8)
    .map((row) => ({
      nomorObat: row.nomorObat,
      nama: row.nama,
      stok: row.stok,
      status: row.status,
    }));

  return {
    totalItems,
    totalUnits,
    amanCount,
    menipisCount,
    kritisCount,
    lowStockItems,
  };
}

async function loadStockRows(client: LiveDbClient, keywords: string[]): Promise<StockItemRecord[]> {
  const totalStockRows = await countRows(client, "demo_stock_items");
  const filter = buildLikeFilter(["nama", "nomor_obat"], keywords);
  const tableName = qualifyTableName(client, "demo_stock_items");

  const dbRowsResult = await client.execute({
    sql: `
      SELECT id, nomor_obat, nama, stok, status
      FROM ${tableName}
      ${filter.clause}
      ORDER BY nama ASC
    `,
    args: filter.args,
  });

  const dbRows: StockItemRecord[] = dbRowsResult.rows.map((row, index) => {
    const typedRow = row as Record<string, unknown>;
    const id = toStringValue(typedRow.id, `stk-${index + 1}`);
    const stok = Math.max(0, Math.round(toNumber(typedRow.stok, 0)));
    return {
      id,
      nomorObat: normalizeMedicineNumber(typedRow.nomor_obat, id, index + 1),
      nama: toStringValue(typedRow.nama, "-"),
      stok,
      status: inferStockStatusByQuantity(stok),
    };
  });

  return totalStockRows > 0 ? dbRows : await loadFallbackStockRows(keywords);
}

async function fetchDispensingSummary(client: LiveDbClient, keywords: string[]): Promise<DispensingSummary> {
  const sourceRows = await loadDispensingRows(client, keywords);

  const counters = {
    menungguValidasiResepCount: 0,
    menungguPembayaranWorkflowCount: 0,
    siapDiracikCount: 0,
    sedangDiracikCount: 0,
    siapDiserahkanCount: 0,
    diserahkanCount: 0,
    cancelCount: 0,
    belumDiserahkanCount: 0,
    menungguPembayaranCount: 0,
    lunasCount: 0,
    gagalCount: 0,
    dibatalkanCount: 0,
    refundCount: 0,
  };

  const inProgressItems: DispensingSummary["inProgressItems"] = [];
  const pendingPaymentItems: DispensingSummary["pendingPaymentItems"] = [];
  const recentTransactions: DispensingSummary["recentTransactions"] = [];

  for (const row of sourceRows) {
    const paymentStatus = normalizePaymentStatus(
      row.rawPaymentStatus,
      inferPaymentStatusFromLegacyStatus(row.rawStatus),
    );

    const workflowStatus = resolveWorkflowStatus(
      row.rawWorkflowStatus,
      row.rawStatus,
      paymentStatus,
    );

    if (recentTransactions.length < 12) {
      recentTransactions.push({
        id: row.id,
        patientName: row.patientName,
        medicineName: row.medicineName,
        nomorPeresepan: row.nomorPeresepan,
        workflowStatus,
        paymentStatus,
        createdAt: row.createdAt,
      });
    }

    if (workflowStatus === "menunggu_validasi_resep") {
      counters.menungguValidasiResepCount += 1;
    } else if (workflowStatus === "menunggu_pembayaran") {
      counters.menungguPembayaranWorkflowCount += 1;
    } else if (workflowStatus === "siap_diracik") {
      counters.siapDiracikCount += 1;
    } else if (workflowStatus === "sedang_diracik") {
      counters.sedangDiracikCount += 1;
    } else if (workflowStatus === "siap_diserahkan") {
      counters.siapDiserahkanCount += 1;
    } else if (workflowStatus === "diserahkan") {
      counters.diserahkanCount += 1;
    } else if (workflowStatus === "cancel") {
      counters.cancelCount += 1;
    }

    if (ACTIVE_WORKFLOW_STATUSES.has(workflowStatus)) {
      counters.belumDiserahkanCount += 1;
      if (inProgressItems.length < 8) {
        inProgressItems.push({
          id: row.id,
          patientName: row.patientName,
          medicineName: row.medicineName,
          nomorObat: row.nomorObat,
          workflowStatus,
          paymentStatus,
        });
      }
    }

    if (paymentStatus === "menunggu_bayar") {
      counters.menungguPembayaranCount += 1;
      if (pendingPaymentItems.length < 8) {
        pendingPaymentItems.push({
          id: row.id,
          patientName: row.patientName,
          medicineName: row.medicineName,
          nomorPeresepan: row.nomorPeresepan,
          paymentStatus,
        });
      }
    } else if (paymentStatus === "lunas") {
      counters.lunasCount += 1;
    } else if (paymentStatus === "gagal") {
      counters.gagalCount += 1;
    } else if (paymentStatus === "dibatalkan") {
      counters.dibatalkanCount += 1;
    } else if (paymentStatus === "refund") {
      counters.refundCount += 1;
    }
  }

  return {
    totalOrders: sourceRows.length,
    menungguValidasiResepCount: counters.menungguValidasiResepCount,
    menungguPembayaranWorkflowCount: counters.menungguPembayaranWorkflowCount,
    siapDiracikCount: counters.siapDiracikCount,
    sedangDiracikCount: counters.sedangDiracikCount,
    siapDiserahkanCount: counters.siapDiserahkanCount,
    diserahkanCount: counters.diserahkanCount,
    cancelCount: counters.cancelCount,
    belumDiserahkanCount: counters.belumDiserahkanCount,
    menungguPembayaranCount: counters.menungguPembayaranCount,
    lunasCount: counters.lunasCount,
    gagalCount: counters.gagalCount,
    dibatalkanCount: counters.dibatalkanCount,
    refundCount: counters.refundCount,
    inProgressItems,
    pendingPaymentItems,
    recentTransactions,
  };
}

async function loadDispensingRows(client: LiveDbClient, keywords: string[]): Promise<DispensingRecord[]> {
  const totalDispensingRows = await countRows(client, "demo_dispensing_orders");
  const filter = buildLikeFilter(
    ["medicine_name", "nomor_obat", "patient_name", "nomor_peresepan"],
    keywords,
  );
  const tableName = qualifyTableName(client, "demo_dispensing_orders");

  const dbRowsResult = await client.execute({
    sql: `
      SELECT
        id,
        patient_name,
        medicine_name,
        nomor_obat,
        nomor_peresepan,
        quantity,
        status,
        workflow_status,
        payment_status,
        created_at
      FROM ${tableName}
      ${filter.clause}
      ORDER BY created_at DESC
    `,
    args: filter.args,
  });

  const dbRows: DispensingRecord[] = dbRowsResult.rows.map((row, index) => {
    const typedRow = row as Record<string, unknown>;
    const id = toStringValue(typedRow.id, `dsp-${index + 1}`);
    const createdAt = toStringValue(typedRow.created_at, new Date().toISOString());
    return {
      id,
      patientName: toStringValue(typedRow.patient_name, "-"),
      medicineName: toStringValue(typedRow.medicine_name, "-"),
      nomorObat: normalizeMedicineNumber(typedRow.nomor_obat, id, index + 1),
      nomorPeresepan: normalizePrescriptionNumber(typedRow.nomor_peresepan, id, createdAt),
      quantity: Math.max(1, Math.round(toNumber(typedRow.quantity, 1))),
      rawStatus: toStringValue(typedRow.status, "diterima").toLowerCase(),
      rawWorkflowStatus: toStringValue(typedRow.workflow_status, "").toLowerCase(),
      rawPaymentStatus: toStringValue(typedRow.payment_status, "").toLowerCase(),
      createdAt,
    };
  });

  return totalDispensingRows > 0 ? dbRows : await loadFallbackDispensingRows(keywords);
}

function formatLiveSummary(
  viewerRole: Exclude<LiveViewerRole, "auto">,
  focus: LiveFocus,
  keyword: string,
  stock: StockSummary,
  dispensing: DispensingSummary,
): string {
  if (viewerRole === "admin") {
    return formatLiveSummaryForAdmin(focus, keyword, stock, dispensing);
  }

  if (viewerRole === "pasien") {
    return formatLiveSummaryForPasien(focus, keyword, stock, dispensing);
  }

  return formatLiveSummaryForApoteker(focus, keyword, stock, dispensing);
}

function formatLiveSummaryForApoteker(
  focus: LiveFocus,
  keyword: string,
  stock: StockSummary,
  dispensing: DispensingSummary,
): string {
  const lines: string[] = [];
  lines.push("STATUS OPERASIONAL APOTEKER (LIVE)");
  if (keyword) {
    lines.push(`Filter konteks: ${keyword}`);
  }
  lines.push("");

  const shouldShowStock = focus === "stok" || focus === "semua";
  const shouldShowDispensing = focus === "dispensing" || focus === "semua";
  const shouldShowPayment = focus === "pembayaran" || focus === "semua";

  if (shouldShowStock) {
    lines.push("[MONITORING STOK]");
    lines.push(`- Total item: ${stock.totalItems}`);
    lines.push(`- Total unit: ${stock.totalUnits}`);
    lines.push(`- Aman: ${stock.amanCount}`);
    lines.push(`- Menipis: ${stock.menipisCount}`);
    lines.push(`- Kritis: ${stock.kritisCount}`);

    if (stock.lowStockItems.length > 0) {
      lines.push("- Prioritas stok rendah:");
      for (const item of stock.lowStockItems.slice(0, 5)) {
        lines.push(
          `  • ${item.nomorObat} | ${item.nama} | stok ${item.stok} | status ${item.status}`,
        );
      }
    } else {
      lines.push("- Tidak ada item menipis/kritis pada filter saat ini.");
    }

    lines.push("");
  }

  if (shouldShowDispensing) {
    lines.push("[STATUS DISPENSING / PENYERAHAN]");
    lines.push(`- Total order: ${dispensing.totalOrders}`);
    lines.push(`- Menunggu validasi resep: ${dispensing.menungguValidasiResepCount}`);
    lines.push(`- Menunggu pembayaran (antrian): ${dispensing.menungguPembayaranWorkflowCount}`);
    lines.push(`- Siap diracik: ${dispensing.siapDiracikCount}`);
    lines.push(`- Sedang diracik: ${dispensing.sedangDiracikCount}`);
    lines.push(`- Siap diserahkan: ${dispensing.siapDiserahkanCount}`);
    lines.push(`- Sudah diserahkan: ${dispensing.diserahkanCount}`);
    lines.push(`- Dibatalkan: ${dispensing.cancelCount}`);
    lines.push(`- Belum diserahkan: ${dispensing.belumDiserahkanCount}`);

    if (dispensing.inProgressItems.length > 0) {
      lines.push("- Order aktif saat ini:");
      for (const item of dispensing.inProgressItems.slice(0, 5)) {
        lines.push(
          `  • ${item.id} | ${item.patientName} | ${item.medicineName} | nomor obat ${item.nomorObat} | workflow ${item.workflowStatus} | bayar ${item.paymentStatus}`,
        );
      }
    } else {
      lines.push("- Tidak ada order dispensing aktif pada filter saat ini.");
    }

    if (dispensing.recentTransactions.length > 0) {
      lines.push("- Aktivitas transaksi terbaru:");
      for (const item of dispensing.recentTransactions.slice(0, 5)) {
        lines.push(
          `  • ${item.createdAt} | ${item.id} | ${item.patientName} | ${item.medicineName} | resep ${item.nomorPeresepan} | workflow ${item.workflowStatus} | bayar ${item.paymentStatus}`,
        );
      }
    }

    lines.push("");
  }

  if (shouldShowPayment) {
    lines.push("[STATUS PEMBAYARAN]");
    lines.push(`- Menunggu pembayaran: ${dispensing.menungguPembayaranCount}`);
    lines.push(`- Lunas: ${dispensing.lunasCount}`);
    lines.push(`- Gagal: ${dispensing.gagalCount}`);
    lines.push(`- Dibatalkan: ${dispensing.dibatalkanCount}`);
    lines.push(`- Refund: ${dispensing.refundCount}`);

    if (dispensing.pendingPaymentItems.length > 0) {
      lines.push("- Daftar menunggu pembayaran:");
      for (const item of dispensing.pendingPaymentItems.slice(0, 5)) {
        lines.push(
          `  • ${item.id} | ${item.patientName} | ${item.medicineName} | resep ${item.nomorPeresepan} | status ${item.paymentStatus}`,
        );
      }
    } else {
      lines.push("- Tidak ada order yang menunggu pembayaran pada filter saat ini.");
    }

    lines.push("");
  }

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

function formatLiveSummaryForAdmin(
  focus: LiveFocus,
  keyword: string,
  stock: StockSummary,
  dispensing: DispensingSummary,
): string {
  const lines: string[] = [];
  lines.push("RINGKASAN KPI OPERASIONAL (ADMIN)");
  if (keyword) {
    lines.push(`Filter konteks: ${keyword}`);
  }
  lines.push("");

  const shouldShowStock = focus === "stok" || focus === "semua";
  const shouldShowDispensing = focus === "dispensing" || focus === "semua";
  const shouldShowPayment = focus === "pembayaran" || focus === "semua";

  const completionRate =
    dispensing.totalOrders > 0
      ? Math.round((dispensing.diserahkanCount / dispensing.totalOrders) * 100)
      : 0;

  const stockRiskRate =
    stock.totalItems > 0
      ? Math.round(((stock.kritisCount + stock.menipisCount) / stock.totalItems) * 100)
      : 0;

  lines.push("[KPI UTAMA]");
  lines.push(`- Total order dispensing: ${dispensing.totalOrders}`);
  lines.push(`- Order aktif (belum diserahkan): ${dispensing.belumDiserahkanCount}`);
  lines.push(`- Completion penyerahan: ${completionRate}%`);
  lines.push(`- Menunggu pembayaran: ${dispensing.menungguPembayaranCount}`);
  lines.push(`- Stok berisiko (menipis+kritis): ${stock.kritisCount + stock.menipisCount} item (${stockRiskRate}%)`);
  lines.push("");

  if (shouldShowDispensing) {
    lines.push("[KPI DISPENSING]");
    lines.push(`- Menunggu validasi resep: ${dispensing.menungguValidasiResepCount}`);
    lines.push(`- Menunggu pembayaran (antrian): ${dispensing.menungguPembayaranWorkflowCount}`);
    lines.push(`- Siap diracik: ${dispensing.siapDiracikCount}`);
    lines.push(`- Sedang diracik: ${dispensing.sedangDiracikCount}`);
    lines.push(`- Siap diserahkan: ${dispensing.siapDiserahkanCount}`);
    lines.push(`- Sudah diserahkan: ${dispensing.diserahkanCount}`);
    lines.push(`- Dibatalkan: ${dispensing.cancelCount}`);
    lines.push("");
  }

  if ((shouldShowDispensing || shouldShowPayment) && dispensing.recentTransactions.length > 0) {
    lines.push("[AKTIVITAS TRANSAKSI TERBARU]");
    for (const item of dispensing.recentTransactions.slice(0, 5)) {
      lines.push(
        `  • ${item.createdAt} | ${item.id} | ${item.patientName} | ${item.medicineName} | workflow ${item.workflowStatus} | bayar ${item.paymentStatus}`,
      );
    }
    lines.push("");
  }

  if (shouldShowPayment) {
    lines.push("[KPI PEMBAYARAN]");
    lines.push(`- Menunggu pembayaran: ${dispensing.menungguPembayaranCount}`);
    lines.push(`- Lunas: ${dispensing.lunasCount}`);
    lines.push(`- Gagal: ${dispensing.gagalCount}`);
    lines.push(`- Dibatalkan: ${dispensing.dibatalkanCount}`);
    lines.push(`- Refund: ${dispensing.refundCount}`);
    lines.push("");
  }

  if (shouldShowStock) {
    lines.push("[KPI STOK]");
    lines.push(`- Total item stok: ${stock.totalItems}`);
    lines.push(`- Aman: ${stock.amanCount}`);
    lines.push(`- Menipis: ${stock.menipisCount}`);
    lines.push(`- Kritis: ${stock.kritisCount}`);

    if (stock.lowStockItems.length > 0) {
      lines.push("- 3 item stok prioritas:");
      for (const item of stock.lowStockItems.slice(0, 3)) {
        lines.push(`  • ${item.nomorObat} | ${item.nama} | ${item.stok} unit | ${item.status}`);
      }
    }
    lines.push("");
  }

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

function formatLiveSummaryForPasien(
  focus: LiveFocus,
  keyword: string,
  stock: StockSummary,
  dispensing: DispensingSummary,
): string {
  const lines: string[] = [];
  lines.push("STATUS LAYANAN APOTEK RSI (LIVE)");
  if (keyword) {
    lines.push(`Filter konteks: ${keyword}`);
  }
  lines.push("");

  const shouldShowStock = focus === "stok" || focus === "semua";
  const shouldShowDispensing = focus === "dispensing" || focus === "semua";
  const shouldShowPayment = focus === "pembayaran" || focus === "semua";

  if (shouldShowDispensing) {
    lines.push("[PROSES DISPENSING SAAT INI]");
    lines.push(`- Menunggu validasi resep: ${dispensing.menungguValidasiResepCount}`);
    lines.push(`- Sedang diracik: ${dispensing.sedangDiracikCount}`);
    lines.push(`- Siap diserahkan: ${dispensing.siapDiserahkanCount}`);
    lines.push(`- Sudah diserahkan: ${dispensing.diserahkanCount}`);

    if (dispensing.recentTransactions.length > 0) {
      lines.push("- Riwayat proses terbaru:");
      for (const item of dispensing.recentTransactions.slice(0, 5)) {
        lines.push(
          `  • ${item.createdAt} | ${item.medicineName} | resep ${item.nomorPeresepan} | status proses ${item.workflowStatus} | pembayaran ${item.paymentStatus}`,
        );
      }
    }

    lines.push("");
  }

  if (shouldShowPayment) {
    lines.push("[STATUS PEMBAYARAN]");
    lines.push(`- Menunggu pembayaran: ${dispensing.menungguPembayaranCount}`);
    lines.push(`- Lunas: ${dispensing.lunasCount}`);
    lines.push(`- Gagal/Dibatalkan/Refund: ${dispensing.gagalCount + dispensing.dibatalkanCount + dispensing.refundCount}`);
    lines.push("");
  }

  if (shouldShowStock) {
    lines.push("[RINGKASAN STOK APOTEK]");
    lines.push(`- Item stok terdata: ${stock.totalItems}`);
    lines.push(`- Item menipis/kritis: ${stock.menipisCount + stock.kritisCount}`);
    lines.push(`- Item aman: ${stock.amanCount}`);
    lines.push("");
  }

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

function determineForecastConfidence(
  sampleOrderCount: number,
  observedDays: number,
): ForecastConfidenceLevel {
  if (sampleOrderCount >= 12 && observedDays >= 21) {
    return "tinggi";
  }

  if (sampleOrderCount >= 5 && observedDays >= 10) {
    return "sedang";
  }

  return "rendah";
}

function determineForecastRiskLevel(daysToStockout: number | null): ForecastRiskLevel {
  if (daysToStockout === null) {
    return "belum_terukur";
  }

  if (daysToStockout <= 3) {
    return "kritis";
  }

  if (daysToStockout <= 7) {
    return "tinggi";
  }

  if (daysToStockout <= 14) {
    return "waspada";
  }

  return "stabil";
}

function isDispensingRecordForecastable(row: DispensingRecord): boolean {
  const paymentStatus = normalizePaymentStatus(
    row.rawPaymentStatus,
    inferPaymentStatusFromLegacyStatus(row.rawStatus),
  );
  const workflowStatus = resolveWorkflowStatus(
    row.rawWorkflowStatus,
    row.rawStatus,
    paymentStatus,
  );

  if (workflowStatus === "cancel") {
    return false;
  }

  return (
    paymentStatus !== "gagal" &&
    paymentStatus !== "dibatalkan" &&
    paymentStatus !== "refund"
  );
}

function isStockMatchForForecast(stockRow: StockItemRecord, dispensingRow: DispensingRecord): boolean {
  const stockCode = stockRow.nomorObat.trim().toUpperCase();
  const dispensingCode = dispensingRow.nomorObat.trim().toUpperCase();
  if (stockCode && dispensingCode && stockCode === dispensingCode) {
    return true;
  }

  const stockRoot = normalizeMedicineRoot(stockRow.nama);
  const dispensingRoot = normalizeMedicineRoot(dispensingRow.medicineName);
  if (!stockRoot || !dispensingRoot) {
    return false;
  }

  if (stockRoot.length < 3 || dispensingRoot.length < 3) {
    return false;
  }

  return (
    stockRoot === dispensingRoot ||
    stockRoot.includes(dispensingRoot) ||
    dispensingRoot.includes(stockRoot)
  );
}

function getNumberFormatter(maxFractionDigits: number): Intl.NumberFormat {
  const existing = numberFormatterCache.get(maxFractionDigits);
  if (existing) {
    return existing;
  }

  const created = new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: maxFractionDigits,
    minimumFractionDigits: 0,
  });

  numberFormatterCache.set(maxFractionDigits, created);
  return created;
}

function formatNumber(value: number, maxFractionDigits = 1): string {
  return getNumberFormatter(maxFractionDigits).format(value);
}

function formatEstimatedDaysToStockout(days: number | null): string {
  if (days === null) {
    return "belum terukur";
  }

  if (days < 1) {
    return "<1 hari";
  }

  return `${formatNumber(days, 1)} hari`;
}

function buildStockForecastSummary(
  stockRows: StockItemRecord[],
  dispensingRows: DispensingRecord[],
  horizonDays: number,
  topK: number,
): StockForecastSummary {
  const forecastableRows = dispensingRows.filter((row) => isDispensingRecordForecastable(row));

  const allItems: StockForecastItem[] = stockRows.map((stockRow) => {
    const relatedRows = forecastableRows.filter((dispensingRow) =>
      isStockMatchForForecast(stockRow, dispensingRow),
    );

    const sampleOrderCount = relatedRows.length;
    const totalDemandQty = relatedRows.reduce(
      (acc, row) => acc + Math.max(1, Math.round(toNumber(row.quantity, 1))),
      0,
    );

    const timestamps = relatedRows
      .map((row) => parseIsoDateToEpoch(row.createdAt))
      .filter((timestamp): timestamp is number => timestamp !== null);

    let observedDays = 0;
    if (sampleOrderCount > 0) {
      if (timestamps.length >= 2) {
        const minTs = Math.min(...timestamps);
        const maxTs = Math.max(...timestamps);
        observedDays = Math.max(1, Math.floor((maxTs - minTs) / MILLIS_PER_DAY) + 1);
      } else {
        observedDays = 1;
      }
    }

    const baseAvgDemandPerDay =
      sampleOrderCount > 0 ? totalDemandQty / Math.max(1, observedDays) : 0;

    let avgDemandPerDay = baseAvgDemandPerDay;
    if (sampleOrderCount >= 4 && timestamps.length >= 3) {
      const latestTs = Math.max(...timestamps);
      const recentWindowDays = Math.max(1, Math.min(7, Math.ceil(observedDays / 2)));
      const recentBoundary = latestTs - (recentWindowDays * MILLIS_PER_DAY);

      const recentRows = relatedRows.filter((row) => {
        const ts = parseIsoDateToEpoch(row.createdAt);
        return ts !== null && ts >= recentBoundary;
      });

      if (recentRows.length > 0) {
        const recentQty = recentRows.reduce(
          (acc, row) => acc + Math.max(1, Math.round(toNumber(row.quantity, 1))),
          0,
        );
        const recentAvgDemandPerDay = recentQty / recentWindowDays;
        avgDemandPerDay = (baseAvgDemandPerDay * 0.6) + (recentAvgDemandPerDay * 0.4);
      }
    }

    const projectedDemandQty = Math.ceil(avgDemandPerDay * horizonDays);
    const safetyStockQty = Math.ceil(avgDemandPerDay * FORECAST_SAFETY_DAYS);
    const recommendedReorderQty = Math.max(
      0,
      projectedDemandQty + safetyStockQty - stockRow.stok,
    );
    const estimatedDaysToStockout =
      avgDemandPerDay > 0 ? stockRow.stok / avgDemandPerDay : null;
    const confidence = determineForecastConfidence(sampleOrderCount, Math.max(0, observedDays));
    const riskLevel = determineForecastRiskLevel(estimatedDaysToStockout);

    return {
      nomorObat: stockRow.nomorObat,
      nama: stockRow.nama,
      stokSaatIni: stockRow.stok,
      sampleOrderCount,
      observedDays,
      avgDemandPerDay,
      projectedDemandQty,
      estimatedDaysToStockout,
      recommendedReorderQty,
      riskLevel,
      confidence,
    };
  });

  const riskOrder: Record<ForecastRiskLevel, number> = {
    kritis: 0,
    tinggi: 1,
    waspada: 2,
    stabil: 3,
    belum_terukur: 4,
  };

  const sortedItems = [...allItems].sort((left, right) => {
    const riskDiff = riskOrder[left.riskLevel] - riskOrder[right.riskLevel];
    if (riskDiff !== 0) {
      return riskDiff;
    }

    const leftDays = left.estimatedDaysToStockout ?? Number.POSITIVE_INFINITY;
    const rightDays = right.estimatedDaysToStockout ?? Number.POSITIVE_INFINITY;
    if (leftDays !== rightDays) {
      return leftDays - rightDays;
    }

    if (left.recommendedReorderQty !== right.recommendedReorderQty) {
      return right.recommendedReorderQty - left.recommendedReorderQty;
    }

    return left.nama.localeCompare(right.nama);
  });

  const totalProjectedDemandQty = allItems.reduce((acc, item) => acc + item.projectedDemandQty, 0);
  const totalRecommendedReorderQty = allItems.reduce(
    (acc, item) => acc + item.recommendedReorderQty,
    0,
  );
  const avgDemandTotalPerDay = allItems.reduce((acc, item) => acc + item.avgDemandPerDay, 0);
  const urgentCount = allItems.filter(
    (item) => item.riskLevel === "kritis" || item.riskLevel === "tinggi",
  ).length;
  const warningCount = allItems.filter((item) => item.riskLevel === "waspada").length;
  const needsReorderCount = allItems.filter((item) => item.recommendedReorderQty > 0).length;

  return {
    horizonDays,
    totalItems: allItems.length,
    totalProjectedDemandQty,
    totalRecommendedReorderQty,
    urgentCount,
    warningCount,
    needsReorderCount,
    avgDemandTotalPerDay,
    items: sortedItems.slice(0, topK),
  };
}

function formatForecastSummary(
  viewerRole: Exclude<LiveViewerRole, "auto">,
  keyword: string,
  summary: StockForecastSummary,
): string {
  if (viewerRole === "admin") {
    return formatForecastSummaryForAdmin(keyword, summary);
  }

  return formatForecastSummaryForApoteker(keyword, summary);
}

function formatForecastSummaryForApoteker(keyword: string, summary: StockForecastSummary): string {
  const lines: string[] = [];
  lines.push("FORECAST KEBUTUHAN STOK APOTEKER (LIVE)");
  if (keyword) {
    lines.push(`Filter konteks: ${keyword}`);
  }
  lines.push(`Periode proyeksi: ${summary.horizonDays} hari`);
  lines.push(
    "Metode: rata-rata demand harian dari histori dispensing aktif + pembobotan data terbaru.",
  );
  lines.push("");

  if (summary.totalItems === 0) {
    lines.push("Tidak ada item stok yang cocok untuk dihitung forecast pada filter saat ini.");
    return lines.join("\n");
  }

  lines.push("[RINGKASAN FORECAST]");
  lines.push(`- Item dianalisis: ${summary.totalItems}`);
  lines.push(`- Estimasi demand total: ${formatNumber(summary.avgDemandTotalPerDay, 2)} unit/hari`);
  lines.push(`- Proyeksi demand ${summary.horizonDays} hari: ${summary.totalProjectedDemandQty} unit`);
  lines.push(`- Item risiko tinggi/kritis: ${summary.urgentCount}`);
  lines.push(`- Item status waspada: ${summary.warningCount}`);
  lines.push(`- Item butuh reorder: ${summary.needsReorderCount}`);
  lines.push(`- Rekomendasi reorder total: ${summary.totalRecommendedReorderQty} unit`);
  lines.push("");

  lines.push(`[PRIORITAS VALIDASI APOTEKER - TOP ${summary.items.length}]`);
  for (const item of summary.items) {
    const demandText =
      item.avgDemandPerDay > 0
        ? `${formatNumber(item.avgDemandPerDay, 2)} unit/hari`
        : "belum terukur";
    const stockoutText = formatEstimatedDaysToStockout(item.estimatedDaysToStockout);
    const sampleInfo =
      item.sampleOrderCount > 0
        ? `${item.sampleOrderCount} order/${Math.max(1, item.observedDays)} hari`
        : "histori belum ada";

    lines.push(
      `  • ${item.nomorObat} | ${item.nama} | stok ${item.stokSaatIni} | demand ${demandText} | habis ~${stockoutText} | reorder ${item.recommendedReorderQty} | risiko ${item.riskLevel} | confidence ${item.confidence} (${sampleInfo})`,
    );
  }

  return lines.join("\n");
}

function formatForecastSummaryForAdmin(keyword: string, summary: StockForecastSummary): string {
  const lines: string[] = [];
  lines.push("FORECAST KPI STOK (ADMIN)");
  if (keyword) {
    lines.push(`Filter konteks: ${keyword}`);
  }
  lines.push(`Periode proyeksi: ${summary.horizonDays} hari`);
  lines.push("");

  if (summary.totalItems === 0) {
    lines.push("Tidak ada item stok yang cocok untuk forecast pada filter saat ini.");
    return lines.join("\n");
  }

  const urgentRate =
    summary.totalItems > 0
      ? Math.round((summary.urgentCount / summary.totalItems) * 100)
      : 0;

  lines.push("[KPI FORECAST]");
  lines.push(`- Item dianalisis: ${summary.totalItems}`);
  lines.push(`- Demand rata-rata harian: ${formatNumber(summary.avgDemandTotalPerDay, 2)} unit/hari`);
  lines.push(`- Proyeksi demand ${summary.horizonDays} hari: ${summary.totalProjectedDemandQty} unit`);
  lines.push(`- Risiko tinggi/kritis: ${summary.urgentCount} item (${urgentRate}%)`);
  lines.push(`- Item perlu reorder: ${summary.needsReorderCount}`);
  lines.push(`- Total rekomendasi reorder: ${summary.totalRecommendedReorderQty} unit`);
  lines.push("");

  lines.push(`[TOP PRIORITAS FORECAST - ${summary.items.length} ITEM]`);
  for (const item of summary.items) {
    lines.push(
      `  • ${item.nomorObat} | ${item.nama} | stok ${item.stokSaatIni} | demand ${formatNumber(item.avgDemandPerDay, 2)} unit/hari | habis ~${formatEstimatedDaysToStockout(item.estimatedDaysToStockout)} | reorder ${item.recommendedReorderQty} | risiko ${item.riskLevel} | confidence ${item.confidence}`,
    );
  }

  return lines.join("\n");
}

async function countRows(client: LiveDbClient, tableName: string): Promise<number> {
  const qualified = qualifyTableName(client, tableName);
  const result = await client.execute({
    sql: `SELECT COUNT(*) AS total FROM ${qualified}`,
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return toNumber(row?.total);
}

export async function getLiveSystemHealthSummary(): Promise<LiveSystemHealthSummary> {
  const client = getClient();
  const dbTarget = buildLiveDbTarget(client);
  const startedAt = Date.now();

  await client.execute({ sql: "SELECT 1 AS ok" });
  const pingMs = Date.now() - startedAt;

  const [hasStockTable, hasDispensingTable] = await Promise.all([
    tableExists(client, "demo_stock_items"),
    tableExists(client, "demo_dispensing_orders"),
  ]);

  const [stockRows, dispensingRows] = await Promise.all([
    hasStockTable ? countRows(client, "demo_stock_items") : Promise.resolve(0),
    hasDispensingTable ? countRows(client, "demo_dispensing_orders") : Promise.resolve(0),
  ]);

  return {
    ok: hasStockTable && hasDispensingTable,
    checkedAt: new Date().toISOString(),
    dbTarget,
    pingMs,
    tables: {
      stock: hasStockTable,
      dispensing: hasDispensingTable,
    },
    rowCounts: {
      stock: stockRows,
      dispensing: dispensingRows,
    },
  };
}

export const getLiveSystemStatus = createTool({
  name: "get-live-system-status",
  description:
    "Gunakan tool ini saat user menanyakan informasi operasional real-time: stok, ketersediaan, sisa unit, proses dispensing, antrian validasi resep, pembayaran, atau riwayat transaksi layanan apotek RSI. Contoh: stok amoxicillin, apakah paracetamol tersedia, sisa obat X berapa, proses dispensing saat ini, riwayat transaksi pasien hari ini.",
  parameters: z.object({
    query: z
      .preprocess((val) => extractString(val), z.string())
      .optional()
      .describe("Pertanyaan user untuk status live. Contoh: stok amoxicillin, apakah paracetamol tersedia, sisa obat X berapa, proses dispensing saat ini, riwayat transaksi pasien hari ini"),
    focus: z
      .enum(["auto", "semua", "stok", "dispensing", "pembayaran"])
      .optional()
      .describe("Fokus status yang ingin diambil; default auto"),
    viewerRole: z
      .enum(["auto", "apoteker", "admin", "pasien"])
      .optional()
      .describe("Format ringkas berdasarkan role: apoteker, admin, atau pasien"),
  }),
  execute: async ({ query, focus, viewerRole }): Promise<string> => {
    try {
      const client = getClient();
      const hasStockTable = await tableExists(client, "demo_stock_items");
      const hasDispensingTable = await tableExists(client, "demo_dispensing_orders");

      if (!hasStockTable || !hasDispensingTable) {
        return "Data operasional live belum siap. Tabel sistem operasional apotek tidak ditemukan.";
      }

      const rawQuery = (query ?? "").trim();
      const keywords = extractOperationalTokens(rawQuery);
      const keyword = keywords.join(" ");
      const resolvedViewerRole = resolveViewerRole(viewerRole ?? "auto");
      const resolvedFocus = resolveFocusByRole(rawQuery, focus ?? "auto", resolvedViewerRole);

      const [stockSummary, dispensingSummary] = await Promise.all([
        fetchStockSummary(client, keywords),
        fetchDispensingSummary(client, keywords),
      ]);

      return formatLiveSummary(
        resolvedViewerRole,
        resolvedFocus,
        keyword,
        stockSummary,
        dispensingSummary,
      );
    } catch (error) {
      return `Terjadi kesalahan saat mengambil status sistem live: ${String(error)}`;
    }
  },
});

export const getLiveSystemForecast = createTool({
  name: "get-live-system-forecast",
  description:
    "Hitung forecasting kebutuhan stok obat berdasarkan histori dispensing live, termasuk estimasi hari stockout dan rekomendasi reorder.",
  parameters: z.object({
    query: z
      .preprocess((val) => extractString(val), z.string())
      .optional()
      .describe("Pertanyaan atau konteks user, contoh: forecast stok amoxicillin 14 hari"),
    horizonDays: z
      .preprocess((val) => parseInteger(val, FORECAST_DEFAULT_HORIZON_DAYS), z.number().int().positive())
      .optional()
      .describe("Horizon proyeksi dalam hari; default 14 hari"),
    topK: z
      .preprocess((val) => parseInteger(val, FORECAST_DEFAULT_TOP_K), z.number().int().positive())
      .optional()
      .describe("Jumlah item prioritas yang ditampilkan; default 5"),
    viewerRole: z
      .enum(["auto", "apoteker", "admin"])
      .optional()
      .describe("Format ringkas berdasarkan role: apoteker atau admin"),
  }),
  execute: async ({ query, horizonDays, topK, viewerRole }): Promise<string> => {
    try {
      const client = getClient();
      const hasStockTable = await tableExists(client, "demo_stock_items");
      const hasDispensingTable = await tableExists(client, "demo_dispensing_orders");

      if (!hasStockTable || !hasDispensingTable) {
        return "Data forecasting live belum siap. Tabel sistem operasional apotek tidak ditemukan.";
      }

      const rawQuery = (query ?? "").trim();
      const keywords = extractForecastKeywords(rawQuery).filter((token) => !/^\d+$/.test(token));
      const keyword = keywords.join(" ");
      const resolvedViewerRole = resolveViewerRole(viewerRole ?? "auto");
      const resolvedHorizonDays = resolveForecastHorizonDays(rawQuery, horizonDays);
      const resolvedTopK = resolveForecastTopK(topK);

      const [stockRows, dispensingRows] = await Promise.all([
        loadStockRows(client, keywords),
        loadDispensingRows(client, keywords),
      ]);

      const forecastSummary = buildStockForecastSummary(
        stockRows,
        dispensingRows,
        resolvedHorizonDays,
        resolvedTopK,
      );

      return formatForecastSummary(resolvedViewerRole, keyword, forecastSummary);
    } catch (error) {
      return `Terjadi kesalahan saat menghitung forecast live: ${String(error)}`;
    }
  },
});
