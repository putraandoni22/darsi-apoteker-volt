import "server-only";

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const DEMO_STORE_MIGRATION_META_KEY = "demo_store_migration_v1";

const MASTER_OBAT_CLINICAL_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS master_obat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama_obat VARCHAR(255) NOT NULL,
  kategori VARCHAR(120) NOT NULL DEFAULT 'umum'
)`;

const CATATAN_ASUHAN_APOTEKER_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS catatan_asuhan_apoteker (
  id TEXT PRIMARY KEY,
  nomor_rm TEXT NOT NULL,
  obat_id INTEGER,
  catatan TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (obat_id) REFERENCES master_obat(id) ON UPDATE CASCADE ON DELETE RESTRICT
)`;

export const demoMetaTable = sqliteTable("demo_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const demoStockItemsTable = sqliteTable("demo_stock_items", {
  id: text("id").primaryKey(),
  nomorObat: text("nomor_obat").notNull(),
  nama: text("nama").notNull(),
  stok: integer("stok").notNull(),
  satuan: text("satuan").notNull(),
  expiredAt: text("expired_at").notNull(),
  lokasi: text("lokasi").notNull(),
  status: text("status").notNull(),
});

export const masterObatTable = sqliteTable("master_obat", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  namaObat: text("nama_obat").notNull(),
  kategori: text("kategori").notNull(),
});

export const catatanAsuhanApotekerTable = sqliteTable("catatan_asuhan_apoteker", {
  id: text("id").primaryKey(),
  nomorRM: text("nomor_rm").notNull(),
  obatId: integer("obat_id").references(() => masterObatTable.id, {
    onUpdate: "cascade",
    onDelete: "restrict",
  }),
  catatan: text("catatan").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const demoDispensingOrdersTable = sqliteTable("demo_dispensing_orders", {
  id: text("id").primaryKey(),
  patientName: text("patient_name").notNull(),
  nomorRM: text("nomor_rm"),
  nomorPeresepan: text("nomor_peresepan"),
  nomorObat: text("nomor_obat"),
  medicineName: text("medicine_name").notNull(),
  dosage: text("dosage").notNull(),
  quantity: integer("quantity").notNull(),
  status: text("status").notNull(),
  workflowStatus: text("workflow_status"),
  paymentStatus: text("payment_status"),
  cancelReason: text("cancel_reason"),
  updatedAt: text("updated_at"),
  createdAt: text("created_at").notNull(),
});

export const demoPatientsTable = sqliteTable("demo_patients", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  nomorRM: text("nomor_rm").notNull(),
  nama: text("nama").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const demoPrescriptionsTable = sqliteTable("demo_prescriptions", {
  id: text("id").primaryKey(),
  nomorPeresepan: text("nomor_peresepan").notNull(),
  nomorRM: text("nomor_rm").notNull(),
  patientName: text("patient_name").notNull(),
  doctorName: text("doctor_name").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const demoPrescriptionItemsTable = sqliteTable("demo_prescription_items", {
  id: text("id").primaryKey(),
  prescriptionId: text("prescription_id").notNull(),
  nomorObat: text("nomor_obat").notNull(),
  medicineName: text("medicine_name").notNull(),
  dosis: text("dosis").notNull(),
  qty: integer("qty").notNull(),
});

export const demoCashierPaymentsTable = sqliteTable("demo_cashier_payments", {
  id: text("id").primaryKey(),
  nomorPeresepan: text("nomor_peresepan").notNull(),
  statusBayar: text("status_bayar").notNull(),
  totalTagihan: integer("total_tagihan").notNull(),
  totalDibayar: integer("total_dibayar").notNull(),
  metodeBayar: text("metode_bayar"),
  paidAt: text("paid_at"),
  updatedAt: text("updated_at").notNull(),
});

export const demoMedicineTransactionsTable = sqliteTable("demo_medicine_transactions", {
  id: text("id").primaryKey(),
  nomorObat: text("nomor_obat").notNull(),
  movementType: text("movement_type").notNull(),
  quantity: integer("quantity").notNull(),
  beforeQty: integer("before_qty").notNull(),
  afterQty: integer("after_qty").notNull(),
  referenceType: text("reference_type").notNull(),
  referenceId: text("reference_id"),
  actorUserId: text("actor_user_id"),
  note: text("note"),
  occurredAt: text("occurred_at").notNull(),
});

export const demoRemindersTable = sqliteTable("demo_reminders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  date: text("date").notNull(),
  time: text("time").notNull(),
  channel: text("channel").notNull(),
  note: text("note").notNull(),
  createdAt: text("created_at").notNull(),
});

const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS demo_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS demo_stock_items (
    id TEXT PRIMARY KEY,
    nomor_obat TEXT NOT NULL,
    nama TEXT NOT NULL,
    stok INTEGER NOT NULL,
    satuan TEXT NOT NULL,
    expired_at TEXT NOT NULL,
    lokasi TEXT NOT NULL,
    status TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_demo_stock_items_nomor_obat
    ON demo_stock_items(nomor_obat)`,
  `CREATE TABLE IF NOT EXISTS demo_dispensing_orders (
    id TEXT PRIMARY KEY,
    patient_name TEXT NOT NULL,
    nomor_rm TEXT,
    nomor_peresepan TEXT,
    nomor_obat TEXT,
    medicine_name TEXT NOT NULL,
    dosage TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    status TEXT NOT NULL,
    workflow_status TEXT,
    payment_status TEXT,
    cancel_reason TEXT,
    updated_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_demo_dispensing_orders_nomor_peresepan
    ON demo_dispensing_orders(nomor_peresepan)`,
  `CREATE TABLE IF NOT EXISTS demo_patients (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    nomor_rm TEXT NOT NULL,
    nama TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_demo_patients_nomor_rm
    ON demo_patients(nomor_rm)`,
  `CREATE TABLE IF NOT EXISTS demo_prescriptions (
    id TEXT PRIMARY KEY,
    nomor_peresepan TEXT NOT NULL,
    nomor_rm TEXT NOT NULL,
    patient_name TEXT NOT NULL,
    doctor_name TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_demo_prescriptions_nomor_peresepan
    ON demo_prescriptions(nomor_peresepan)`,
  `CREATE TABLE IF NOT EXISTS demo_prescription_items (
    id TEXT PRIMARY KEY,
    prescription_id TEXT NOT NULL,
    nomor_obat TEXT NOT NULL,
    medicine_name TEXT NOT NULL,
    dosis TEXT NOT NULL,
    qty INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_demo_prescription_items_prescription_id
    ON demo_prescription_items(prescription_id)`,
  `CREATE TABLE IF NOT EXISTS demo_cashier_payments (
    id TEXT PRIMARY KEY,
    nomor_peresepan TEXT NOT NULL,
    status_bayar TEXT NOT NULL,
    total_tagihan INTEGER NOT NULL,
    total_dibayar INTEGER NOT NULL,
    metode_bayar TEXT,
    paid_at TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_demo_cashier_payments_nomor_peresepan
    ON demo_cashier_payments(nomor_peresepan)`,
  `CREATE TABLE IF NOT EXISTS demo_medicine_transactions (
    id TEXT PRIMARY KEY,
    nomor_obat TEXT NOT NULL,
    movement_type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    before_qty INTEGER NOT NULL,
    after_qty INTEGER NOT NULL,
    reference_type TEXT NOT NULL,
    reference_id TEXT,
    actor_user_id TEXT,
    note TEXT,
    occurred_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_demo_medicine_transactions_nomor_obat
    ON demo_medicine_transactions(nomor_obat)`,
  `CREATE TABLE IF NOT EXISTS demo_reminders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    channel TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_demo_reminders_user_id
    ON demo_reminders(user_id)`,
];

let cachedClient: Client | null = null;
let cachedDb: ReturnType<typeof drizzle> | null = null;
let schemaReadyPromise: Promise<void> | null = null;

function resolveDemoDbUrl(): string {
  const dedicated = process.env.DEMO_LIBSQL_DATABASE_URL?.trim();
  if (dedicated) {
    return dedicated;
  }

  const shared = process.env.LIBSQL_DATABASE_URL?.trim();
  if (shared) {
    return shared;
  }

  return `file:${path.join(process.cwd(), "data", "demo-workflows.db")}`;
}

function resolveDemoDbAuthToken(): string | undefined {
  const dedicated = process.env.DEMO_LIBSQL_AUTH_TOKEN?.trim();
  if (dedicated) {
    return dedicated;
  }

  const shared = process.env.LIBSQL_AUTH_TOKEN?.trim();
  return shared || undefined;
}

async function ensureLocalDirectory(url: string): Promise<void> {
  if (!url.startsWith("file:")) {
    return;
  }

  const rawPath = url.slice("file:".length);
  const normalizedPath = rawPath.startsWith("//") ? rawPath.slice(1) : rawPath;
  const directoryPath = path.dirname(normalizedPath);
  await mkdir(directoryPath, { recursive: true });
}

function getClient(): Client {
  if (cachedClient) {
    return cachedClient;
  }

  const url = resolveDemoDbUrl();
  const authToken = resolveDemoDbAuthToken();
  cachedClient = createClient({
    url,
    ...(authToken ? { authToken } : {}),
  });
  return cachedClient;
}

function getDbInstance(): ReturnType<typeof drizzle> {
  if (cachedDb) {
    return cachedDb;
  }

  cachedDb = drizzle(getClient());
  return cachedDb;
}

async function tableExists(client: Client, tableName: string): Promise<boolean> {
  const result = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    args: [tableName],
  });

  return result.rows.length > 0;
}

async function getTableColumnNames(client: Client, tableName: string): Promise<string[]> {
  const result = await client.execute(`PRAGMA table_info(${tableName})`);

  return result.rows
    .map((row) => {
      const rawName = row.name;
      return typeof rawName === "string" ? rawName.toLowerCase() : null;
    })
    .filter((name): name is string => Boolean(name));
}

function hasColumn(columnNames: string[], columnName: string): boolean {
  return columnNames.includes(columnName.toLowerCase());
}

function isMasterObatClinicalSchema(columnNames: string[]): boolean {
  if (columnNames.length !== 3) {
    return false;
  }

  const normalized = new Set(columnNames);
  return (
    normalized.has("id") &&
    normalized.has("nama_obat") &&
    normalized.has("kategori")
  );
}

async function ensureMasterObatClinicalSchema(client: Client): Promise<void> {
  const exists = await tableExists(client, "master_obat");

  if (!exists) {
    await client.execute(MASTER_OBAT_CLINICAL_SCHEMA_SQL);
    return;
  }

  const columnNames = await getTableColumnNames(client, "master_obat");
  if (isMasterObatClinicalSchema(columnNames)) {
    return;
  }

  const legacyTableName = `master_obat_legacy_${Date.now()}`;
  const idExpression = columnNames.includes("obat_id")
    ? "CAST(OBAT_ID AS INTEGER)"
    : columnNames.includes("id")
      ? "CAST(id AS INTEGER)"
      : "NULL";
  const namaObatExpression = columnNames.includes("obat_nama")
    ? "NULLIF(TRIM(OBAT_NAMA), '')"
    : columnNames.includes("nama_obat")
      ? "NULLIF(TRIM(nama_obat), '')"
      : columnNames.includes("obat_nama_generik")
        ? "NULLIF(TRIM(OBAT_NAMA_GENERIK), '')"
        : "NULL";
  const kategoriExpression = columnNames.includes("kategori")
    ? "NULLIF(TRIM(kategori), '')"
    : "'umum'";

  await client.execute("BEGIN");

  try {
    await client.execute(`ALTER TABLE master_obat RENAME TO ${legacyTableName}`);
    await client.execute(MASTER_OBAT_CLINICAL_SCHEMA_SQL);
    await client.execute(`
      INSERT INTO master_obat (id, nama_obat, kategori)
      SELECT
        ${idExpression},
        COALESCE(${namaObatExpression}, 'NAMA_TIDAK_DIKETAHUI'),
        COALESCE(${kategoriExpression}, 'umum')
      FROM ${legacyTableName}
    `);
    await client.execute(`DROP TABLE ${legacyTableName}`);
    await client.execute("COMMIT");
  } catch (error) {
    await client.execute("ROLLBACK");
    throw error;
  }
}

async function ensureCatatanAsuhanApotekerSchema(client: Client): Promise<void> {
  const ensureIndexes = async () => {
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_catatan_asuhan_apoteker_nomor_rm
      ON catatan_asuhan_apoteker(nomor_rm)`);
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_catatan_asuhan_apoteker_obat_id
      ON catatan_asuhan_apoteker(obat_id)`);
  };

  const exists = await tableExists(client, "catatan_asuhan_apoteker");

  if (!exists) {
    await client.execute(CATATAN_ASUHAN_APOTEKER_SCHEMA_SQL);
    await ensureIndexes();
    return;
  }

  const columnNames = await getTableColumnNames(client, "catatan_asuhan_apoteker");
  if (hasColumn(columnNames, "obat_id")) {
    await ensureIndexes();
    return;
  }

  const legacyTableName = `catatan_asuhan_apoteker_legacy_${Date.now()}`;
  const idExpression = hasColumn(columnNames, "id")
    ? "COALESCE(NULLIF(TRIM(CAST(id AS TEXT)), ''), lower(hex(randomblob(16))))"
    : "lower(hex(randomblob(16)))";
  const nomorRmExpression = hasColumn(columnNames, "nomor_rm")
    ? "COALESCE(NULLIF(TRIM(CAST(nomor_rm AS TEXT)), ''), 'RM-UNKNOWN')"
    : "'RM-UNKNOWN'";
  const catatanExpression = hasColumn(columnNames, "catatan")
    ? "COALESCE(CAST(catatan AS TEXT), '')"
    : "''";
  const createdAtExpression = hasColumn(columnNames, "created_at")
    ? "COALESCE(NULLIF(TRIM(CAST(created_at AS TEXT)), ''), datetime('now'))"
    : "datetime('now')";
  const updatedAtExpression = hasColumn(columnNames, "updated_at")
    ? "COALESCE(NULLIF(TRIM(CAST(updated_at AS TEXT)), ''), datetime('now'))"
    : "datetime('now')";

  await client.execute("BEGIN");

  try {
    await client.execute(`ALTER TABLE catatan_asuhan_apoteker RENAME TO ${legacyTableName}`);
    await client.execute(CATATAN_ASUHAN_APOTEKER_SCHEMA_SQL);
    await client.execute(`
      INSERT INTO catatan_asuhan_apoteker (id, nomor_rm, obat_id, catatan, created_at, updated_at)
      SELECT
        ${idExpression},
        ${nomorRmExpression},
        NULL,
        ${catatanExpression},
        ${createdAtExpression},
        ${updatedAtExpression}
      FROM ${legacyTableName}
    `);
    await client.execute(`DROP TABLE ${legacyTableName}`);
    await client.execute("COMMIT");
  } catch (error) {
    await client.execute("ROLLBACK");
    throw error;
  }

  await ensureIndexes();
}

async function ensureSchemaReady(): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const url = resolveDemoDbUrl();
      await ensureLocalDirectory(url);

      const client = getClient();
      for (const statement of SCHEMA_STATEMENTS) {
        await client.execute(statement);
      }

      await ensureMasterObatClinicalSchema(client);
      await ensureCatatanAsuhanApotekerSchema(client);
    })();
  }

  await schemaReadyPromise;
}

export async function getDemoDb(): Promise<ReturnType<typeof drizzle>> {
  await ensureSchemaReady();
  return getDbInstance();
}

export async function readDemoMetaValue(key: string): Promise<string | null> {
  const db = await getDemoDb();
  const rows = await db
    .select({ value: demoMetaTable.value })
    .from(demoMetaTable)
    .where(eq(demoMetaTable.key, key))
    .limit(1);

  return rows[0]?.value ?? null;
}

export async function writeDemoMetaValue(key: string, value: string): Promise<void> {
  const db = await getDemoDb();
  const updatedAt = new Date().toISOString();

  await db
    .insert(demoMetaTable)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({
      target: demoMetaTable.key,
      set: {
        value,
        updatedAt,
      },
    });
}
