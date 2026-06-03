import "server-only";

import type {
	DemoCashierPayment,
	DemoDispensingOrder,
	DemoPatientRecord,
	DemoPrescriptionRecord,
} from "@/lib/demo/types";
import {
	getPgPool,
	isPgDispensingEnabled,
	quoteIdentifier,
	resolveDispensingTableName,
} from "@/lib/db/pg";

const PRESCRIPTIONS_TABLE = "darsi_ph_prescriptions";
const PRESCRIPTION_ITEMS_TABLE = "darsi_ph_prescription_items";
const PATIENTS_TABLE = "darsi_ph_patients";
const PAYMENTS_TABLE = "darsi_ph_cashier_payments";
const MIGRATION_META_KEY = "darsi_ph_dispensing_pg_migrated_v1";

export interface DispensingPgSnapshot {
	dispensingOrders: DemoDispensingOrder[];
	prescriptions: DemoPrescriptionRecord[];
	patients: DemoPatientRecord[];
	cashierPayments: DemoCashierPayment[];
}

let schemaReadyPromise: Promise<void> | null = null;

function dispensingTable(): string {
	return quoteIdentifier(resolveDispensingTableName());
}

function q(table: string): string {
	return quoteIdentifier(table);
}

async function getPool() {
	const pool = getPgPool("DARSI_DB");
	if (!pool) {
		throw new Error(
			"PostgreSQL DARSI_DB belum dikonfigurasi. Set DARSI_DB_HOST, DARSI_DB_DATABASE, DARSI_DB_USERNAME, dan DARSI_DB_PASSWORD.",
		);
	}
	return pool;
}

export function isDispensingPostgresActive(): boolean {
	return isPgDispensingEnabled();
}

async function ensureSchema(): Promise<void> {
	if (!schemaReadyPromise) {
		schemaReadyPromise = (async () => {
			const pool = await getPool();
			const dispensing = dispensingTable();

			await pool.query(`
        CREATE TABLE IF NOT EXISTS ${dispensing} (
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
          updated_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

			await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_darsi_ph_dispensing_nomor_peresepan
          ON ${dispensing} (nomor_peresepan)
      `);

			await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_darsi_ph_dispensing_created_at
          ON ${dispensing} (created_at DESC)
      `);

			await pool.query(`
        CREATE TABLE IF NOT EXISTS ${q(PRESCRIPTIONS_TABLE)} (
          id TEXT PRIMARY KEY,
          nomor_peresepan TEXT NOT NULL UNIQUE,
          nomor_rm TEXT NOT NULL,
          patient_name TEXT NOT NULL,
          doctor_name TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

			await pool.query(`
        CREATE TABLE IF NOT EXISTS ${q(PRESCRIPTION_ITEMS_TABLE)} (
          id TEXT PRIMARY KEY,
          prescription_id TEXT NOT NULL REFERENCES ${q(PRESCRIPTIONS_TABLE)}(id) ON DELETE CASCADE,
          nomor_obat TEXT NOT NULL,
          medicine_name TEXT NOT NULL,
          dosis TEXT NOT NULL,
          qty INTEGER NOT NULL
        )
      `);

			await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_darsi_ph_prescription_items_prescription_id
          ON ${q(PRESCRIPTION_ITEMS_TABLE)} (prescription_id)
      `);

			await pool.query(`
        CREATE TABLE IF NOT EXISTS ${q(PATIENTS_TABLE)} (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          nomor_rm TEXT NOT NULL UNIQUE,
          nama TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

			await pool.query(`
        CREATE TABLE IF NOT EXISTS ${q(PAYMENTS_TABLE)} (
          id TEXT PRIMARY KEY,
          nomor_peresepan TEXT NOT NULL UNIQUE,
          status_bayar TEXT NOT NULL,
          total_tagihan INTEGER NOT NULL,
          total_dibayar INTEGER NOT NULL,
          metode_bayar TEXT,
          paid_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
		})().catch((error) => {
			schemaReadyPromise = null;
			throw error;
		});
	}

	await schemaReadyPromise;
}

function toIsoString(value: unknown): string {
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (typeof value === "string" && value.trim().length > 0) {
		return value;
	}
	return new Date().toISOString();
}

function mapDispensingRow(row: Record<string, unknown>): DemoDispensingOrder {
	return {
		id: String(row.id),
		patientName: String(row.patient_name),
		nomorRM: row.nomor_rm ? String(row.nomor_rm) : undefined,
		nomorPeresepan: row.nomor_peresepan ? String(row.nomor_peresepan) : undefined,
		nomorObat: row.nomor_obat ? String(row.nomor_obat) : undefined,
		medicineName: String(row.medicine_name),
		dosage: String(row.dosage),
		quantity: Number(row.quantity),
		status: row.status as DemoDispensingOrder["status"],
		workflowStatus: row.workflow_status
			? (row.workflow_status as DemoDispensingOrder["workflowStatus"])
			: undefined,
		paymentStatus: row.payment_status
			? (row.payment_status as DemoDispensingOrder["paymentStatus"])
			: undefined,
		cancelReason: row.cancel_reason ? String(row.cancel_reason) : undefined,
		updatedAt: row.updated_at ? toIsoString(row.updated_at) : undefined,
		createdAt: toIsoString(row.created_at),
	};
}

export async function readDispensingPgSnapshot(): Promise<DispensingPgSnapshot> {
	await ensureSchema();
	const pool = await getPool();
	const dispensing = dispensingTable();

	const ordersResult = await pool.query(
		`SELECT * FROM ${dispensing} ORDER BY created_at DESC`,
	);

	const prescriptionsResult = await pool.query(
		`SELECT * FROM ${q(PRESCRIPTIONS_TABLE)} ORDER BY created_at DESC`,
	);

	const itemsResult = await pool.query(
		`SELECT * FROM ${q(PRESCRIPTION_ITEMS_TABLE)}`,
	);

	const patientsResult = await pool.query(
		`SELECT * FROM ${q(PATIENTS_TABLE)} ORDER BY nama ASC`,
	);

	const paymentsResult = await pool.query(`SELECT * FROM ${q(PAYMENTS_TABLE)}`);

	const itemsByPrescriptionId = new Map<string, DemoPrescriptionRecord["items"]>();
	for (const row of itemsResult.rows) {
		const prescriptionId = String(row.prescription_id);
		const bucket = itemsByPrescriptionId.get(prescriptionId) ?? [];
		bucket.push({
			id: String(row.id),
			nomorObat: String(row.nomor_obat),
			medicineName: String(row.medicine_name),
			dosis: String(row.dosis),
			qty: Number(row.qty),
		});
		itemsByPrescriptionId.set(prescriptionId, bucket);
	}

	const prescriptions: DemoPrescriptionRecord[] = prescriptionsResult.rows.map(
		(row) => ({
			id: String(row.id),
			nomorPeresepan: String(row.nomor_peresepan),
			nomorRM: String(row.nomor_rm),
			patientName: String(row.patient_name),
			doctorName: String(row.doctor_name),
			status: row.status as DemoPrescriptionRecord["status"],
			createdAt: toIsoString(row.created_at),
			updatedAt: toIsoString(row.updated_at),
			items: itemsByPrescriptionId.get(String(row.id)) ?? [],
		}),
	);

	const patients: DemoPatientRecord[] = patientsResult.rows.map((row) => ({
		id: String(row.id),
		userId: row.user_id ? String(row.user_id) : undefined,
		nomorRM: String(row.nomor_rm),
		nama: String(row.nama),
		createdAt: toIsoString(row.created_at),
		updatedAt: toIsoString(row.updated_at),
	}));

	const cashierPayments: DemoCashierPayment[] = paymentsResult.rows.map((row) => ({
		id: String(row.id),
		nomorPeresepan: String(row.nomor_peresepan),
		statusBayar: row.status_bayar as DemoCashierPayment["statusBayar"],
		totalTagihan: Number(row.total_tagihan),
		totalDibayar: Number(row.total_dibayar),
		metodeBayar: row.metode_bayar
			? (row.metode_bayar as DemoCashierPayment["metodeBayar"])
			: undefined,
		paidAt: row.paid_at ? toIsoString(row.paid_at) : undefined,
		updatedAt: toIsoString(row.updated_at),
	}));

	return {
		dispensingOrders: ordersResult.rows.map((row) =>
			mapDispensingRow(row as Record<string, unknown>),
		),
		prescriptions,
		patients,
		cashierPayments,
	};
}

export async function persistDispensingPgSnapshot(
	snapshot: DispensingPgSnapshot,
): Promise<void> {
	await ensureSchema();
	const pool = await getPool();
	const client = await pool.connect();
	const dispensing = dispensingTable();

	try {
		await client.query("BEGIN");

		await client.query(`DELETE FROM ${q(PRESCRIPTION_ITEMS_TABLE)}`);
		await client.query(`DELETE FROM ${q(PAYMENTS_TABLE)}`);
		await client.query(`DELETE FROM ${dispensing}`);
		await client.query(`DELETE FROM ${q(PRESCRIPTIONS_TABLE)}`);
		await client.query(`DELETE FROM ${q(PATIENTS_TABLE)}`);

		for (const patient of snapshot.patients) {
			await client.query(
				`INSERT INTO ${q(PATIENTS_TABLE)}
          (id, user_id, nomor_rm, nama, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)`,
				[
					patient.id,
					patient.userId ?? null,
					patient.nomorRM,
					patient.nama,
					patient.createdAt,
					patient.updatedAt,
				],
			);
		}

		for (const prescription of snapshot.prescriptions) {
			await client.query(
				`INSERT INTO ${q(PRESCRIPTIONS_TABLE)}
          (id, nomor_peresepan, nomor_rm, patient_name, doctor_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)`,
				[
					prescription.id,
					prescription.nomorPeresepan,
					prescription.nomorRM,
					prescription.patientName,
					prescription.doctorName,
					prescription.status,
					prescription.createdAt,
					prescription.updatedAt,
				],
			);

			for (const item of prescription.items) {
				await client.query(
					`INSERT INTO ${q(PRESCRIPTION_ITEMS_TABLE)}
            (id, prescription_id, nomor_obat, medicine_name, dosis, qty)
           VALUES ($1, $2, $3, $4, $5, $6)`,
					[
						item.id,
						prescription.id,
						item.nomorObat,
						item.medicineName,
						item.dosis,
						item.qty,
					],
				);
			}
		}

		for (const payment of snapshot.cashierPayments) {
			await client.query(
				`INSERT INTO ${q(PAYMENTS_TABLE)}
          (id, nomor_peresepan, status_bayar, total_tagihan, total_dibayar, metode_bayar, paid_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)`,
				[
					payment.id,
					payment.nomorPeresepan,
					payment.statusBayar,
					payment.totalTagihan,
					payment.totalDibayar,
					payment.metodeBayar ?? null,
					payment.paidAt ?? null,
					payment.updatedAt,
				],
			);
		}

		for (const order of snapshot.dispensingOrders) {
			await client.query(
				`INSERT INTO ${dispensing}
          (id, patient_name, nomor_rm, nomor_peresepan, nomor_obat, medicine_name, dosage, quantity,
           status, workflow_status, payment_status, cancel_reason, updated_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz, $14::timestamptz)`,
				[
					order.id,
					order.patientName,
					order.nomorRM ?? null,
					order.nomorPeresepan ?? null,
					order.nomorObat ?? null,
					order.medicineName,
					order.dosage,
					order.quantity,
					order.status,
					order.workflowStatus ?? null,
					order.paymentStatus ?? null,
					order.cancelReason ?? null,
					order.updatedAt ?? order.createdAt,
					order.createdAt,
				],
			);
		}

		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

export async function migrateDispensingFromSqliteIfNeeded(
	sqliteSnapshot: DispensingPgSnapshot,
): Promise<boolean> {
	if (!isDispensingPostgresActive()) {
		return false;
	}

	await ensureSchema();
	const pool = await getPool();
	const dispensing = dispensingTable();

	const marker = await pool.query(
		`SELECT 1 FROM ${dispensing} LIMIT 1`,
	);
	const hasRows = marker.rowCount && marker.rowCount > 0;

	if (hasRows) {
		return false;
	}

	const hasSqliteData =
		sqliteSnapshot.dispensingOrders.length > 0 ||
		sqliteSnapshot.prescriptions.length > 0 ||
		sqliteSnapshot.patients.length > 0 ||
		sqliteSnapshot.cashierPayments.length > 0;

	if (!hasSqliteData) {
		return false;
	}

	await persistDispensingPgSnapshot(sqliteSnapshot);
	return true;
}

export async function clearDispensingPgSnapshot(): Promise<{
	deletedOrders: number;
	deletedPrescriptions: number;
	deletedPayments: number;
	deletedPatients: number;
}> {
	await ensureSchema();
	const pool = await getPool();
	const dispensing = dispensingTable();

	const ordersCount = await pool.query(`SELECT COUNT(*)::int AS c FROM ${dispensing}`);
	const prescriptionsCount = await pool.query(
		`SELECT COUNT(*)::int AS c FROM ${q(PRESCRIPTIONS_TABLE)}`,
	);
	const paymentsCount = await pool.query(
		`SELECT COUNT(*)::int AS c FROM ${q(PAYMENTS_TABLE)}`,
	);
	const patientsCount = await pool.query(
		`SELECT COUNT(*)::int AS c FROM ${q(PATIENTS_TABLE)}`,
	);

	await persistDispensingPgSnapshot({
		dispensingOrders: [],
		prescriptions: [],
		patients: [],
		cashierPayments: [],
	});

	return {
		deletedOrders: Number(ordersCount.rows[0]?.c ?? 0),
		deletedPrescriptions: Number(prescriptionsCount.rows[0]?.c ?? 0),
		deletedPayments: Number(paymentsCount.rows[0]?.c ?? 0),
		deletedPatients: Number(patientsCount.rows[0]?.c ?? 0),
	};
}

export { MIGRATION_META_KEY as DISPENSING_PG_MIGRATION_META_KEY };
