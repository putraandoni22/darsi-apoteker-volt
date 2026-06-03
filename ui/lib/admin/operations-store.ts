import "server-only";

import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { listPublicUsers } from "@/lib/auth/store";
import {
  demoCashierPaymentsTable,
  demoDispensingOrdersTable,
  demoMedicineTransactionsTable,
  demoPatientsTable,
  demoPrescriptionsTable,
  demoStockItemsTable,
  getDemoDb,
} from "@/lib/demo/db";
import {
  listDispensingOrders,
  listMedicineTransactions,
  listStockItems,
} from "@/lib/demo/store";

export type KnowledgeBaseDocumentStatus = "indexed" | "waiting";

export interface KnowledgeBaseDocument {
  id: string;
  name: string;
  type: string;
  version: string;
  updatedAt: string;
  status: KnowledgeBaseDocumentStatus;
  fileName?: string;
  sourcePath?: string;
  fileSizeBytes?: number;
}

export interface AdminOperationsStatus {
  dataSource: {
    lastSyncAt: string | null;
    lastSchemaValidationAt: string | null;
    lastStatusRefreshAt: string | null;
    note: string | null;
  };
  vector: {
    scheduleEnabled: boolean;
    scheduleTime: string;
    lastIndexedAt: string | null;
    lastIndexedCount: number;
    pendingCount: number;
  };
  system: {
    maintenanceMode: boolean;
    lastBackupAt: string | null;
    lastRestoreAt: string | null;
    lastRestartAt: string | null;
  };
}

export interface DataSourceSyncResult {
  userCount: number;
  stockItemCount: number;
  dispensingOrderCount: number;
  transactionCount: number;
}

export interface SchemaValidationCheck {
  name: string;
  ok: boolean;
  note: string;
}

export interface SchemaValidationResult {
  allOk: boolean;
  checks: SchemaValidationCheck[];
}

export interface SystemBackupSummary {
  backupId: string;
  fileName: string;
  createdAt: string;
  sizeBytes: number;
}

interface BackupFileEntry {
  relativePath: string;
  encoding: "base64";
  content: string;
  byteLength: number;
}

interface BackupPayload {
  backupId: string;
  createdAt: string;
  version: 1;
  files: BackupFileEntry[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const KB_DOCUMENT_STORAGE_DIR = path.join(DATA_DIR, "kb-documents");
const BACKUP_STORAGE_DIR = path.join(DATA_DIR, "backups");
const KNOWLEDGE_BASE_STORE_FILE = path.join(DATA_DIR, "admin-knowledge-base.json");
const OPERATIONS_STATE_FILE = path.join(DATA_DIR, "admin-ops-state.json");

const INITIAL_KNOWLEDGE_BASE_DOCUMENTS: KnowledgeBaseDocument[] = [
  {
    id: "kbdoc-bpjs-202604",
    name: "Pedoman BPJS Terbaru",
    type: "PDF",
    version: "v2026.04",
    updatedAt: "2026-04-10T13:10:00.000Z",
    status: "indexed",
  },
  {
    id: "kbdoc-sop-dispensing-202602",
    name: "SOP Dispensing RSI",
    type: "PDF",
    version: "v2026.02",
    updatedAt: "2026-04-09T08:40:00.000Z",
    status: "indexed",
  },
  {
    id: "kbdoc-icd-internal-202603",
    name: "Referensi ICD Internal",
    type: "CSV",
    version: "v2026.03",
    updatedAt: "2026-04-08T10:05:00.000Z",
    status: "waiting",
  },
  {
    id: "kbdoc-kronis-rsi-202604",
    name: "Katalog Obat Kronis RSI",
    type: "CSV",
    version: "v2026.04",
    updatedAt: "2026-04-11T07:30:00.000Z",
    status: "indexed",
  },
];

const INITIAL_OPERATIONS_STATUS: AdminOperationsStatus = {
  dataSource: {
    lastSyncAt: null,
    lastSchemaValidationAt: null,
    lastStatusRefreshAt: null,
    note: null,
  },
  vector: {
    scheduleEnabled: true,
    scheduleTime: "01:30",
    lastIndexedAt: null,
    lastIndexedCount: 0,
    pendingCount: 1,
  },
  system: {
    maintenanceMode: false,
    lastBackupAt: null,
    lastRestoreAt: null,
    lastRestartAt: null,
  },
};

const BASE_BACKUP_RELATIVE_PATHS = [
  "activity-logs.json",
  "auth-users.json",
  "auth-password-resets.json",
  "demo-workflows.db",
  "demo-workflows.json",
  "admin-knowledge-base.json",
  "admin-ops-state.json",
];

let writeQueue: Promise<void> = Promise.resolve();

function cloneInitialKnowledgeBaseDocuments(): KnowledgeBaseDocument[] {
  return JSON.parse(JSON.stringify(INITIAL_KNOWLEDGE_BASE_DOCUMENTS)) as KnowledgeBaseDocument[];
}

function cloneInitialOpsStatus(): AdminOperationsStatus {
  return JSON.parse(JSON.stringify(INITIAL_OPERATIONS_STATUS)) as AdminOperationsStatus;
}

function toIsoNow(): string {
  return new Date().toISOString();
}

function normalizeText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  return fallback;
}

function normalizeNumber(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return value;
}

function sanitizeFileName(value: string): string {
  const normalized = value.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "");
  return normalized.length > 0 ? normalized : `document-${randomUUID().slice(0, 8)}.bin`;
}

function inferDocumentType(fileName: string): string {
  const extension = path.extname(fileName).replace(".", "").trim().toUpperCase();
  return extension.length > 0 ? extension : "BIN";
}

function createVersionStamp(): string {
  const now = new Date();
  return `v${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function bumpVersion(previous: string): string {
  const normalized = previous.trim();
  const match = normalized.match(/^(.*)-r(\d+)$/i);
  if (!match) {
    return `${normalized || createVersionStamp()}-r2`;
  }

  const nextRevision = Number.parseInt(match[2] || "1", 10) + 1;
  return `${match[1]}-r${nextRevision}`;
}

function toSafeBackupId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function resolveDataPath(relativePath: string): string {
  const resolved = path.resolve(DATA_DIR, relativePath);
  const dataRoot = path.resolve(DATA_DIR);
  if (!resolved.startsWith(dataRoot)) {
    throw new Error("Path backup tidak valid.");
  }

  return resolved;
}

async function ensureStoreFiles(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(KB_DOCUMENT_STORAGE_DIR, { recursive: true });
  await mkdir(BACKUP_STORAGE_DIR, { recursive: true });

  try {
    await readFile(KNOWLEDGE_BASE_STORE_FILE, "utf-8");
  } catch {
    await writeFile(
      KNOWLEDGE_BASE_STORE_FILE,
      JSON.stringify({ documents: cloneInitialKnowledgeBaseDocuments() }, null, 2),
      "utf-8",
    );
  }

  try {
    await readFile(OPERATIONS_STATE_FILE, "utf-8");
  } catch {
    await writeFile(
      OPERATIONS_STATE_FILE,
      JSON.stringify(cloneInitialOpsStatus(), null, 2),
      "utf-8",
    );
  }
}

async function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = writeQueue;
  let releaseCurrent!: () => void;

  writeQueue = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });

  await previous;

  try {
    return await operation();
  } finally {
    releaseCurrent();
  }
}

async function readKnowledgeBaseDocumentsFromStore(): Promise<KnowledgeBaseDocument[]> {
  await ensureStoreFiles();

  try {
    const content = await readFile(KNOWLEDGE_BASE_STORE_FILE, "utf-8");
    const parsed = JSON.parse(content) as { documents?: unknown };
    if (!Array.isArray(parsed.documents)) {
      return cloneInitialKnowledgeBaseDocuments();
    }

    const normalized = parsed.documents
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const candidate = item as Partial<KnowledgeBaseDocument>;
        const id = normalizeText(candidate.id);
        const name = normalizeText(candidate.name);
        const type = normalizeText(candidate.type);
        const version = normalizeText(candidate.version);
        const updatedAt = normalizeText(candidate.updatedAt);

        if (!id || !name || !type || !version || !updatedAt) {
          return null;
        }

        const normalizedDocument: KnowledgeBaseDocument = {
          id,
          name,
          type,
          version,
          updatedAt,
          status: candidate.status === "waiting" ? "waiting" : "indexed",
        };

        const fileName = normalizeText(candidate.fileName);
        if (fileName) {
          normalizedDocument.fileName = fileName;
        }

        const sourcePath = normalizeText(candidate.sourcePath);
        if (sourcePath) {
          normalizedDocument.sourcePath = sourcePath;
        }

        const fileSizeBytes = normalizeNumber(candidate.fileSizeBytes, 0);
        if (fileSizeBytes > 0) {
          normalizedDocument.fileSizeBytes = fileSizeBytes;
        }

        return normalizedDocument;
      })
      .filter((item): item is KnowledgeBaseDocument => Boolean(item));

    if (normalized.length === 0) {
      return cloneInitialKnowledgeBaseDocuments();
    }

    return normalized.sort(
      (first, second) =>
        new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime(),
    );
  } catch {
    return cloneInitialKnowledgeBaseDocuments();
  }
}

async function writeKnowledgeBaseDocumentsToStore(documents: KnowledgeBaseDocument[]): Promise<void> {
  await ensureStoreFiles();

  const payload = {
    documents: [...documents].sort(
      (first, second) =>
        new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime(),
    ),
  };

  const tempPath = `${KNOWLEDGE_BASE_STORE_FILE}.tmp`;
  await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf-8");
  await rename(tempPath, KNOWLEDGE_BASE_STORE_FILE);
}

async function readOperationsStatusFromStore(): Promise<AdminOperationsStatus> {
  await ensureStoreFiles();

  try {
    const content = await readFile(OPERATIONS_STATE_FILE, "utf-8");
    const parsed = JSON.parse(content) as Partial<AdminOperationsStatus>;

    return {
      dataSource: {
        lastSyncAt: normalizeText(parsed.dataSource?.lastSyncAt, "") || null,
        lastSchemaValidationAt:
          normalizeText(parsed.dataSource?.lastSchemaValidationAt, "") || null,
        lastStatusRefreshAt:
          normalizeText(parsed.dataSource?.lastStatusRefreshAt, "") || null,
        note: normalizeText(parsed.dataSource?.note, "") || null,
      },
      vector: {
        scheduleEnabled: normalizeBoolean(parsed.vector?.scheduleEnabled, true),
        scheduleTime: normalizeText(parsed.vector?.scheduleTime, "01:30"),
        lastIndexedAt: normalizeText(parsed.vector?.lastIndexedAt, "") || null,
        lastIndexedCount: normalizeNumber(parsed.vector?.lastIndexedCount, 0),
        pendingCount: normalizeNumber(parsed.vector?.pendingCount, 0),
      },
      system: {
        maintenanceMode: normalizeBoolean(parsed.system?.maintenanceMode, false),
        lastBackupAt: normalizeText(parsed.system?.lastBackupAt, "") || null,
        lastRestoreAt: normalizeText(parsed.system?.lastRestoreAt, "") || null,
        lastRestartAt: normalizeText(parsed.system?.lastRestartAt, "") || null,
      },
    };
  } catch {
    return cloneInitialOpsStatus();
  }
}

async function writeOperationsStatusToStore(status: AdminOperationsStatus): Promise<void> {
  await ensureStoreFiles();

  const tempPath = `${OPERATIONS_STATE_FILE}.tmp`;
  await writeFile(tempPath, JSON.stringify(status, null, 2), "utf-8");
  await rename(tempPath, OPERATIONS_STATE_FILE);
}

function countPendingDocuments(documents: KnowledgeBaseDocument[]): number {
  return documents.filter((item) => item.status === "waiting").length;
}

async function collectKnowledgeBaseFileRelativePaths(): Promise<string[]> {
  await ensureStoreFiles();

  const queue = [KB_DOCUMENT_STORAGE_DIR];
  const relativePaths: string[] = [];

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) {
      continue;
    }

    let children: string[] = [];
    try {
      children = await readdir(currentDir);
    } catch {
      continue;
    }

    for (const child of children) {
      const absolutePath = path.join(currentDir, child);
      const childStat = await stat(absolutePath);

      if (childStat.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }

      const relativePath = path.relative(DATA_DIR, absolutePath).replace(/\\/g, "/");
      relativePaths.push(relativePath);
    }
  }

  return relativePaths;
}

export async function listKnowledgeBaseDocuments(): Promise<KnowledgeBaseDocument[]> {
  return readKnowledgeBaseDocumentsFromStore();
}

export async function uploadKnowledgeBaseDocument(input: {
  fileName: string;
  fileBuffer: Buffer;
}): Promise<KnowledgeBaseDocument> {
  return withWriteLock(async () => {
    await ensureStoreFiles();

    const safeFileName = sanitizeFileName(input.fileName || "dokumen-upload.bin");
    const uniqueStorageName = `${Date.now()}-${randomUUID().slice(0, 8)}-${safeFileName}`;
    const sourcePath = path.join("kb-documents", uniqueStorageName).replace(/\\/g, "/");
    const destinationPath = resolveDataPath(sourcePath);

    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, input.fileBuffer);

    const documents = await readKnowledgeBaseDocumentsFromStore();
    const now = toIsoNow();

    const newDocument: KnowledgeBaseDocument = {
      id: `kbdoc-${randomUUID().slice(0, 10)}`,
      name: safeFileName,
      type: inferDocumentType(safeFileName),
      version: createVersionStamp(),
      updatedAt: now,
      status: "waiting",
      fileName: safeFileName,
      sourcePath,
      fileSizeBytes: input.fileBuffer.byteLength,
    };

    const nextDocuments = [newDocument, ...documents];
    await writeKnowledgeBaseDocumentsToStore(nextDocuments);

    const status = await readOperationsStatusFromStore();
    status.vector.pendingCount = countPendingDocuments(nextDocuments);
    await writeOperationsStatusToStore(status);

    return newDocument;
  });
}

export async function updateKnowledgeBaseDocument(documentId: string): Promise<KnowledgeBaseDocument> {
  return withWriteLock(async () => {
    const normalizedId = normalizeText(documentId);
    if (!normalizedId) {
      throw new Error("documentId wajib diisi.");
    }

    const documents = await readKnowledgeBaseDocumentsFromStore();
    const index = documents.findIndex((item) => item.id === normalizedId);
    if (index < 0) {
      throw new Error("Dokumen knowledge base tidak ditemukan.");
    }

    const target = documents[index];
    const updated: KnowledgeBaseDocument = {
      ...target,
      version: bumpVersion(target.version),
      updatedAt: toIsoNow(),
      status: "waiting",
    };

    documents[index] = updated;
    await writeKnowledgeBaseDocumentsToStore(documents);

    const status = await readOperationsStatusFromStore();
    status.vector.pendingCount = countPendingDocuments(documents);
    await writeOperationsStatusToStore(status);

    return updated;
  });
}

export async function deleteKnowledgeBaseDocument(documentId: string): Promise<void> {
  return withWriteLock(async () => {
    const normalizedId = normalizeText(documentId);
    if (!normalizedId) {
      throw new Error("documentId wajib diisi.");
    }

    const documents = await readKnowledgeBaseDocumentsFromStore();
    const target = documents.find((item) => item.id === normalizedId);
    if (!target) {
      throw new Error("Dokumen knowledge base tidak ditemukan.");
    }

    const nextDocuments = documents.filter((item) => item.id !== normalizedId);
    await writeKnowledgeBaseDocumentsToStore(nextDocuments);

    if (target.sourcePath) {
      try {
        const targetFilePath = resolveDataPath(target.sourcePath);
        await unlink(targetFilePath);
      } catch {
        // ignore missing file on disk
      }
    }

    const status = await readOperationsStatusFromStore();
    status.vector.pendingCount = countPendingDocuments(nextDocuments);
    await writeOperationsStatusToStore(status);
  });
}

export async function reindexKnowledgeBaseDocuments(options?: {
  documentIds?: string[];
}): Promise<{ indexedCount: number; pendingCount: number }> {
  return withWriteLock(async () => {
    const documents = await readKnowledgeBaseDocumentsFromStore();
    const selectedIds = new Set((options?.documentIds ?? []).map((item) => item.trim()).filter(Boolean));
    const now = toIsoNow();

    let indexedCount = 0;
    const nextDocuments: KnowledgeBaseDocument[] = documents.map(
      (item): KnowledgeBaseDocument => {
      const shouldReindex = selectedIds.size === 0 || selectedIds.has(item.id);
      if (!shouldReindex) {
        return item;
      }

      if (item.status === "waiting") {
        indexedCount += 1;
      }

      return {
        ...item,
        status: "indexed",
        updatedAt: now,
      };
      },
    );

    await writeKnowledgeBaseDocumentsToStore(nextDocuments);

    const pendingCount = countPendingDocuments(nextDocuments);
    const status = await readOperationsStatusFromStore();
    status.vector.pendingCount = pendingCount;
    status.vector.lastIndexedAt = now;
    status.vector.lastIndexedCount = indexedCount;
    await writeOperationsStatusToStore(status);

    return {
      indexedCount,
      pendingCount,
    };
  });
}

export async function setVectorSyncSchedule(options: {
  enabled: boolean;
  scheduleTime?: string;
}): Promise<AdminOperationsStatus> {
  return withWriteLock(async () => {
    const status = await readOperationsStatusFromStore();
    const documents = await readKnowledgeBaseDocumentsFromStore();

    status.vector.scheduleEnabled = options.enabled;
    if (options.scheduleTime && options.scheduleTime.trim()) {
      status.vector.scheduleTime = options.scheduleTime.trim();
    }
    status.vector.pendingCount = countPendingDocuments(documents);

    await writeOperationsStatusToStore(status);
    return status;
  });
}

export async function getAdminOperationsStatus(): Promise<AdminOperationsStatus> {
  const [status, documents] = await Promise.all([
    readOperationsStatusFromStore(),
    readKnowledgeBaseDocumentsFromStore(),
  ]);

  return {
    ...status,
    vector: {
      ...status.vector,
      pendingCount: countPendingDocuments(documents),
    },
  };
}

export async function refreshAdminOperationsStatus(): Promise<AdminOperationsStatus> {
  return withWriteLock(async () => {
    const status = await readOperationsStatusFromStore();
    const documents = await readKnowledgeBaseDocumentsFromStore();

    status.dataSource.lastStatusRefreshAt = toIsoNow();
    status.vector.pendingCount = countPendingDocuments(documents);

    await writeOperationsStatusToStore(status);
    return status;
  });
}

export async function runDataSourceSync(): Promise<DataSourceSyncResult> {
  const [users, stockItems, dispensingOrders, transactions] = await Promise.all([
    listPublicUsers(),
    listStockItems({ includeCatalog: true }),
    listDispensingOrders(),
    listMedicineTransactions({ limit: 5000 }),
  ]);

  await withWriteLock(async () => {
    const status = await readOperationsStatusFromStore();
    const documents = await readKnowledgeBaseDocumentsFromStore();
    const now = toIsoNow();

    status.dataSource.lastSyncAt = now;
    status.dataSource.lastStatusRefreshAt = now;
    status.dataSource.note = `Sinkron data: user ${users.length}, stok ${stockItems.length}, dispensing ${dispensingOrders.length}, transaksi ${transactions.length}.`;
    status.vector.pendingCount = countPendingDocuments(documents);

    await writeOperationsStatusToStore(status);
  });

  return {
    userCount: users.length,
    stockItemCount: stockItems.length,
    dispensingOrderCount: dispensingOrders.length,
    transactionCount: transactions.length,
  };
}

export async function runSchemaValidation(): Promise<SchemaValidationResult> {
  const checks: SchemaValidationCheck[] = [];

  try {
    const db = await getDemoDb();

    await Promise.all([
      db.select({ id: demoStockItemsTable.id }).from(demoStockItemsTable).limit(1),
      db
        .select({ id: demoDispensingOrdersTable.id })
        .from(demoDispensingOrdersTable)
        .limit(1),
      db.select({ id: demoPatientsTable.id }).from(demoPatientsTable).limit(1),
      db.select({ id: demoPrescriptionsTable.id }).from(demoPrescriptionsTable).limit(1),
      db
        .select({ id: demoCashierPaymentsTable.id })
        .from(demoCashierPaymentsTable)
        .limit(1),
      db
        .select({ id: demoMedicineTransactionsTable.id })
        .from(demoMedicineTransactionsTable)
        .limit(1),
    ]);

    checks.push({
      name: "Skema demo LibSQL",
      ok: true,
      note: "Seluruh tabel utama dapat diakses.",
    });
  } catch (error) {
    checks.push({
      name: "Skema demo LibSQL",
      ok: false,
      note: error instanceof Error ? error.message : "Gagal mengakses skema demo.",
    });
  }

  try {
    const users = await listPublicUsers();
    checks.push({
      name: "Store user",
      ok: true,
      note: `Store user aktif (${users.length} user).`,
    });
  } catch (error) {
    checks.push({
      name: "Store user",
      ok: false,
      note: error instanceof Error ? error.message : "Store user gagal diakses.",
    });
  }

  try {
    const docs = await readKnowledgeBaseDocumentsFromStore();
    checks.push({
      name: "Store knowledge base",
      ok: true,
      note: `Store knowledge base aktif (${docs.length} dokumen).`,
    });
  } catch (error) {
    checks.push({
      name: "Store knowledge base",
      ok: false,
      note: error instanceof Error ? error.message : "Store knowledge base gagal diakses.",
    });
  }

  const allOk = checks.every((item) => item.ok);

  await withWriteLock(async () => {
    const status = await readOperationsStatusFromStore();

    status.dataSource.lastSchemaValidationAt = toIsoNow();
    status.dataSource.lastStatusRefreshAt = toIsoNow();
    status.dataSource.note = allOk
      ? "Validasi skema berhasil tanpa error."
      : "Validasi skema menemukan error. Lihat detail hasil validasi.";

    await writeOperationsStatusToStore(status);
  });

  return {
    allOk,
    checks,
  };
}

function createBackupId(): string {
  const now = new Date();
  const idTime = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate(),
  ).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(
    now.getMinutes(),
  ).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;

  return `backup-${idTime}-${randomUUID().slice(0, 8)}`;
}

async function buildBackupPayload(): Promise<BackupPayload> {
  await ensureStoreFiles();

  const backupId = createBackupId();
  const createdAt = toIsoNow();

  const dynamicRelativePaths = await collectKnowledgeBaseFileRelativePaths();
  const allRelativePaths = [...new Set([...BASE_BACKUP_RELATIVE_PATHS, ...dynamicRelativePaths])];

  const files: BackupFileEntry[] = [];

  for (const relativePath of allRelativePaths) {
    const absolutePath = resolveDataPath(relativePath);

    try {
      const fileBuffer = await readFile(absolutePath);
      files.push({
        relativePath,
        encoding: "base64",
        content: fileBuffer.toString("base64"),
        byteLength: fileBuffer.byteLength,
      });
    } catch {
      // ignore non-existing optional file
    }
  }

  return {
    backupId,
    createdAt,
    version: 1,
    files,
  };
}

function backupFilePathFromId(backupId: string): string {
  const safeId = toSafeBackupId(backupId);
  if (!safeId) {
    throw new Error("backupId tidak valid.");
  }

  return path.join(BACKUP_STORAGE_DIR, `${safeId}.json`);
}

export async function listSystemBackups(): Promise<SystemBackupSummary[]> {
  await ensureStoreFiles();

  let entries: string[] = [];
  try {
    entries = await readdir(BACKUP_STORAGE_DIR);
  } catch {
    return [];
  }

  const summaries = await Promise.all(
    entries
      .filter((fileName) => fileName.endsWith(".json"))
      .map(async (fileName) => {
        const backupId = fileName.replace(/\.json$/i, "");
        const absolutePath = path.join(BACKUP_STORAGE_DIR, fileName);
        const info = await stat(absolutePath);

        return {
          backupId,
          fileName,
          createdAt: info.mtime.toISOString(),
          sizeBytes: info.size,
        } satisfies SystemBackupSummary;
      }),
  );

  return summaries.sort(
    (first, second) =>
      new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime(),
  );
}

export async function createSystemBackup(): Promise<SystemBackupSummary> {
  return withWriteLock(async () => {
    const payload = await buildBackupPayload();
    const backupPath = backupFilePathFromId(payload.backupId);

    await mkdir(path.dirname(backupPath), { recursive: true });
    await writeFile(backupPath, JSON.stringify(payload, null, 2), "utf-8");

    const info = await stat(backupPath);

    const status = await readOperationsStatusFromStore();
    status.system.lastBackupAt = toIsoNow();
    await writeOperationsStatusToStore(status);

    return {
      backupId: payload.backupId,
      fileName: path.basename(backupPath),
      createdAt: info.mtime.toISOString(),
      sizeBytes: info.size,
    };
  });
}

async function readBackupPayload(backupId: string): Promise<BackupPayload> {
  const backupPath = backupFilePathFromId(backupId);
  const content = await readFile(backupPath, "utf-8");
  const parsed = JSON.parse(content) as Partial<BackupPayload>;

  if (
    typeof parsed.backupId !== "string" ||
    typeof parsed.createdAt !== "string" ||
    !Array.isArray(parsed.files)
  ) {
    throw new Error("Format backup tidak valid.");
  }

  return {
    backupId: parsed.backupId,
    createdAt: parsed.createdAt,
    version: 1,
    files: parsed.files
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }

        const candidate = entry as Partial<BackupFileEntry>;
        const relativePath = normalizeText(candidate.relativePath);
        const contentText = normalizeText(candidate.content);

        if (!relativePath || !contentText) {
          return null;
        }

        return {
          relativePath,
          encoding: "base64",
          content: contentText,
          byteLength: normalizeNumber(candidate.byteLength, 0),
        } satisfies BackupFileEntry;
      })
      .filter((entry): entry is BackupFileEntry => Boolean(entry)),
  };
}

export async function restoreSystemBackup(backupId: string): Promise<{ restoredFiles: number }> {
  return withWriteLock(async () => {
    const payload = await readBackupPayload(backupId);

    let restoredFiles = 0;
    for (const fileEntry of payload.files) {
      const destinationPath = resolveDataPath(fileEntry.relativePath);
      const buffer = Buffer.from(fileEntry.content, "base64");

      await mkdir(path.dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, buffer);
      restoredFiles += 1;
    }

    const status = await readOperationsStatusFromStore();
    status.system.lastRestoreAt = toIsoNow();
    await writeOperationsStatusToStore(status);

    return { restoredFiles };
  });
}

export async function readBackupFileForDownload(backupId: string): Promise<{
  fileName: string;
  content: string;
}> {
  const safeBackupId = toSafeBackupId(backupId);
  if (!safeBackupId) {
    throw new Error("backupId tidak valid.");
  }

  const backupPath = backupFilePathFromId(safeBackupId);
  const content = await readFile(backupPath, "utf-8");

  return {
    fileName: `${safeBackupId}.json`,
    content,
  };
}

export async function toggleMaintenanceMode(enabled: boolean): Promise<AdminOperationsStatus> {
  return withWriteLock(async () => {
    const status = await readOperationsStatusFromStore();
    status.system.maintenanceMode = enabled;
    await writeOperationsStatusToStore(status);
    return status;
  });
}

export async function restartLocalServiceSoft(): Promise<{
  syncedStockItems: number;
  syncedTransactions: number;
  syncedDispensingOrders: number;
}> {
  const [stockItems, transactions, dispensingOrders] = await Promise.all([
    listStockItems({ includeCatalog: true }),
    listMedicineTransactions({ limit: 3000 }),
    listDispensingOrders(),
  ]);

  await withWriteLock(async () => {
    const status = await readOperationsStatusFromStore();
    status.system.lastRestartAt = toIsoNow();
    status.dataSource.lastStatusRefreshAt = toIsoNow();
    await writeOperationsStatusToStore(status);
  });

  return {
    syncedStockItems: stockItems.length,
    syncedTransactions: transactions.length,
    syncedDispensingOrders: dispensingOrders.length,
  };
}
