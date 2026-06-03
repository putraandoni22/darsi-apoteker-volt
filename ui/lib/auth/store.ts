import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";

export type UserRole = "admin" | "apoteker" | "pasien";

export interface UserRecord {
	id: string;
	name: string;
	email: string;
	passwordHash: string;
	role: UserRole;
	createdAt: string;
	nomorRM: string | null;
}

export interface PublicUser {
	id: string;
	name: string;
	email: string;
	role: UserRole;
	createdAt: string;
	nomorRM: string | null;
}

export type DeleteUserError =
	| "USER_NOT_FOUND"
	| "CANNOT_DELETE_SELF"
	| "CANNOT_DELETE_LAST_ADMIN";

export type UpdateUserRoleError =
	| "USER_NOT_FOUND"
	| "INVALID_ROLE"
	| "CANNOT_CHANGE_SELF_ROLE"
	| "CANNOT_DEMOTE_LAST_ADMIN";

export interface DeleteUserResult {
	user: PublicUser | null;
	error: DeleteUserError | null;
}

export interface UpdateUserRoleResult {
	user: PublicUser | null;
	error: UpdateUserRoleError | null;
}

export class CreateUserConflictError extends Error {
	constructor() {
		super("EMAIL_ALREADY_EXISTS");
		this.name = "CreateUserConflictError";
	}
}

interface AuthUserRow {
	id: string;
	name: string;
	email: string;
	password_hash: string;
	role: string;
	created_at: Date | string;
	nomor_rm: string | null;
}

interface LegacyAuthStore {
	users: unknown[];
}

interface CountRow {
	count: number;
}

const NOMOR_RM_PREFIX = "RM";
const NOMOR_RM_DIGITS = 6;
const NOMOR_RM_REGEX = /^RM\d{6}$/;
const WRITE_LOCK_KEY = 1_957_004;
const LEGACY_STORE_PATHS = [
	path.join(process.cwd(), "data", "auth-users.json"),
	path.join(process.cwd(), "ui", "data", "auth-users.json"),
];

const AUTH_DB_HOST = process.env.AUTH_DB_HOST?.trim() || "127.0.0.1";
const AUTH_DB_PORT = parsePort(process.env.AUTH_DB_PORT, 3307);
const AUTH_DB_NAME = process.env.AUTH_DB_NAME?.trim() || "daftar_login";
const AUTH_DB_USER = process.env.AUTH_DB_USER?.trim() || "darsilogin";
const AUTH_DB_PASSWORD = process.env.AUTH_DB_PASSWORD?.trim() || "darsilogin";
const AUTH_DB_SSL =
	process.env.AUTH_DB_SSL?.trim().toLowerCase() === "true";

const pool = new Pool({
	host: AUTH_DB_HOST,
	port: AUTH_DB_PORT,
	database: AUTH_DB_NAME,
	user: AUTH_DB_USER,
	password: AUTH_DB_PASSWORD,
	ssl: AUTH_DB_SSL ? { rejectUnauthorized: false } : undefined,
	max: 10,
});

let ensureSchemaPromise: Promise<void> | null = null;

function parsePort(value: string | undefined, fallback: number): number {
	if (!value) {
		return fallback;
	}

	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed) || parsed < 1 || parsed > 65_535) {
		return fallback;
	}

	return parsed;
}

function isUserRole(value: unknown): value is UserRole {
	return value === "admin" || value === "apoteker" || value === "pasien";
}

function resolveRoleFromUnknown(value: unknown): UserRole {
	if (value === "admin") {
		return "admin";
	}

	if (value === "pasien" || value === "user") {
		return "pasien";
	}

	return "apoteker";
}

function normalizeNomorRM(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalized = value.trim().toUpperCase();
	if (!NOMOR_RM_REGEX.test(normalized)) {
		return null;
	}

	return normalized;
}

function formatNomorRM(sequence: number): string {
	return `${NOMOR_RM_PREFIX}${sequence
		.toString()
		.padStart(NOMOR_RM_DIGITS, "0")}`;
}

function getNomorRMSequence(nomorRM: string): number {
	return Number.parseInt(nomorRM.slice(NOMOR_RM_PREFIX.length), 10);
}

function assignNextNomorRM(
	usedNomorRM: Set<string>,
	highestSequence: number,
): string {
	let sequence = highestSequence;

	while (true) {
		sequence += 1;
		const candidate = formatNomorRM(sequence);
		if (usedNomorRM.has(candidate)) {
			continue;
		}

		usedNomorRM.add(candidate);
		return candidate;
	}
}

function ensurePatientNomorRM(users: UserRecord[]): {
	users: UserRecord[];
	changed: boolean;
} {
	const normalizedUsers = users.map((user) => {
		const normalizedNomorRM = normalizeNomorRM(user.nomorRM);
		return {
			...user,
			nomorRM: user.role === "pasien" ? normalizedNomorRM : null,
		};
	});

	let changed = normalizedUsers.some(
		(user, index) => user.nomorRM !== users[index]?.nomorRM,
	);

	const usedNomorRM = new Set<string>();
	let highestSequence = 0;

	for (const user of normalizedUsers) {
		if (user.role !== "pasien" || !user.nomorRM) {
			continue;
		}

		if (usedNomorRM.has(user.nomorRM)) {
			user.nomorRM = null;
			changed = true;
			continue;
		}

		usedNomorRM.add(user.nomorRM);
		highestSequence = Math.max(
			highestSequence,
			getNomorRMSequence(user.nomorRM),
		);
	}

	for (const user of normalizedUsers) {
		if (user.role !== "pasien" || user.nomorRM) {
			continue;
		}

		user.nomorRM = assignNextNomorRM(usedNomorRM, highestSequence);
		highestSequence = getNomorRMSequence(user.nomorRM);
		changed = true;
	}

	return {
		users: normalizedUsers,
		changed,
	};
}

function normalizeLegacyUserRecord(value: unknown): UserRecord | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const user = value as Partial<UserRecord>;
	const normalizedRole = resolveRoleFromUnknown(user.role);
	const normalizedNomorRM = normalizeNomorRM(user.nomorRM);
	if (
		typeof user.id !== "string" ||
		typeof user.name !== "string" ||
		typeof user.email !== "string" ||
		typeof user.passwordHash !== "string"
	) {
		return null;
	}

	const createdAtValue =
		typeof user.createdAt === "string" &&
		!Number.isNaN(Date.parse(user.createdAt))
			? new Date(user.createdAt).toISOString()
			: new Date().toISOString();

	return {
		id: user.id,
		name: user.name,
		email: user.email.trim().toLowerCase(),
		passwordHash: user.passwordHash,
		role: normalizedRole,
		createdAt: createdAtValue,
		nomorRM: normalizedRole === "pasien" ? normalizedNomorRM : null,
	};
}

function mapRowToUserRecord(row: AuthUserRow): UserRecord {
	const role = resolveRoleFromUnknown(row.role);
	const nomorRM = normalizeNomorRM(row.nomor_rm);
	const createdAtDate =
		row.created_at instanceof Date ? row.created_at : new Date(row.created_at);

	return {
		id: row.id,
		name: row.name,
		email: row.email,
		passwordHash: row.password_hash,
		role,
		createdAt: Number.isNaN(createdAtDate.valueOf())
			? new Date().toISOString()
			: createdAtDate.toISOString(),
		nomorRM: role === "pasien" ? nomorRM : null,
	};
}

function parseCount(value: number): number {
	if (!Number.isFinite(value) || value < 0) {
		return 0;
	}

	return Math.trunc(value);
}

function isFileMissingError(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}

	return "code" in error && (error as { code?: string }).code === "ENOENT";
}

async function loadLegacyUsers(): Promise<UserRecord[]> {
	for (const filePath of LEGACY_STORE_PATHS) {
		let raw: string;
		try {
			raw = await readFile(filePath, "utf-8");
		} catch (error) {
			if (isFileMissingError(error)) {
				continue;
			}
			return [];
		}

		try {
			const parsed = JSON.parse(raw) as Partial<LegacyAuthStore>;
			if (!Array.isArray(parsed.users)) {
				return [];
			}

			const users = parsed.users
				.map((user) => normalizeLegacyUserRecord(user))
				.filter((user): user is UserRecord => Boolean(user));
			return ensurePatientNomorRM(users).users;
		} catch {
			return [];
		}
	}

	return [];
}

async function ensureAuthSchema(): Promise<void> {
	if (!ensureSchemaPromise) {
		ensureSchemaPromise = (async () => {
			const client = await pool.connect();
			try {
				await client.query(`
					CREATE TABLE IF NOT EXISTS auth_users (
						id UUID PRIMARY KEY,
						name TEXT NOT NULL,
						email TEXT NOT NULL,
						password_hash TEXT NOT NULL,
						role TEXT NOT NULL CHECK (role IN ('admin', 'apoteker', 'pasien')),
						created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						nomor_rm TEXT UNIQUE
					)
				`);

				await client.query(
					"CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_lower_idx ON auth_users (LOWER(email))",
				);
				await client.query(
					"CREATE INDEX IF NOT EXISTS auth_users_role_idx ON auth_users (role)",
				);

				const countResult = await client.query<CountRow>(
					"SELECT COUNT(*)::int AS count FROM auth_users",
				);
				const rowCount = parseCount(countResult.rows[0]?.count ?? 0);
				if (rowCount > 0) {
					return;
				}

				const legacyUsers = await loadLegacyUsers();
				if (legacyUsers.length === 0) {
					return;
				}

				for (const user of legacyUsers) {
					await client.query(
						`
							INSERT INTO auth_users (
								id,
								name,
								email,
								password_hash,
								role,
								created_at,
								nomor_rm
							) VALUES ($1, $2, $3, $4, $5, $6, $7)
							ON CONFLICT DO NOTHING
						`,
						[
							user.id,
							user.name,
							user.email,
							user.passwordHash,
							user.role,
							user.createdAt,
							user.nomorRM,
						],
					);
				}
			} finally {
				client.release();
			}
		})().catch((error: unknown) => {
			ensureSchemaPromise = null;
			throw error;
		});
	}

	await ensureSchemaPromise;
}

async function withTransaction<T>(
	operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
	await ensureAuthSchema();
	const client = await pool.connect();

	try {
		await client.query("BEGIN");
		const result = await operation(client);
		await client.query("COMMIT");
		return result;
	} catch (error) {
		try {
			await client.query("ROLLBACK");
		} catch {
			// Ignore rollback errors and rethrow the original one.
		}
		throw error;
	} finally {
		client.release();
	}
}

async function lockWrites(client: PoolClient): Promise<void> {
	await client.query("SELECT pg_advisory_xact_lock($1)", [WRITE_LOCK_KEY]);
}

async function getNextNomorRM(
	client: PoolClient,
	excludeUserId?: string,
): Promise<string> {
	const params: string[] = [];
	let query =
		"SELECT nomor_rm FROM auth_users WHERE role = 'pasien' AND nomor_rm IS NOT NULL";

	if (excludeUserId) {
		params.push(excludeUserId);
		query += " AND id <> $1";
	}

	const rows = await client.query<{ nomor_rm: string }>(query, params);
	const usedNomorRM = new Set<string>();
	let highestSequence = 0;

	for (const row of rows.rows) {
		const normalized = normalizeNomorRM(row.nomor_rm);
		if (!normalized || usedNomorRM.has(normalized)) {
			continue;
		}

		usedNomorRM.add(normalized);
		highestSequence = Math.max(highestSequence, getNomorRMSequence(normalized));
	}

	return assignNextNomorRM(usedNomorRM, highestSequence);
}

async function getUserByIdForUpdate(
	client: PoolClient,
	userId: string,
): Promise<UserRecord | null> {
	const result = await client.query<AuthUserRow>(
		`SELECT id, name, email, password_hash, role, created_at, nomor_rm
		 FROM auth_users
		 WHERE id = $1
		 FOR UPDATE`,
		[userId],
	);

	if (result.rows.length === 0) {
		return null;
	}

	return mapRowToUserRecord(result.rows[0]);
}

export function toPublicUser(user: UserRecord): PublicUser {
	return {
		id: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
		createdAt: user.createdAt,
		nomorRM: user.nomorRM,
	};
}

export async function listPublicUsers(): Promise<PublicUser[]> {
	await ensureAuthSchema();
	const result = await pool.query<AuthUserRow>(
		`SELECT id, name, email, password_hash, role, created_at, nomor_rm
		 FROM auth_users
		 ORDER BY created_at ASC`,
	);

	return result.rows.map((row) => toPublicUser(mapRowToUserRecord(row)));
}

export async function findUserByEmail(
	email: string,
): Promise<UserRecord | null> {
	await ensureAuthSchema();
	const normalizedEmail = email.trim().toLowerCase();
	if (!normalizedEmail) {
		return null;
	}

	const result = await pool.query<AuthUserRow>(
		`SELECT id, name, email, password_hash, role, created_at, nomor_rm
		 FROM auth_users
		 WHERE LOWER(email) = LOWER($1)
		 LIMIT 1`,
		[normalizedEmail],
	);

	if (result.rows.length === 0) {
		return null;
	}

	return mapRowToUserRecord(result.rows[0]);
}

export async function findUserById(userId: string): Promise<UserRecord | null> {
	await ensureAuthSchema();
	const result = await pool.query<AuthUserRow>(
		`SELECT id, name, email, password_hash, role, created_at, nomor_rm
		 FROM auth_users
		 WHERE id = $1
		 LIMIT 1`,
		[userId],
	);

	if (result.rows.length === 0) {
		return null;
	}

	return mapRowToUserRecord(result.rows[0]);
}

export async function createUser(input: {
	name: string;
	email: string;
	passwordHash: string;
	role?: UserRole;
}): Promise<UserRecord> {
	return withTransaction(async (client) => {
		await lockWrites(client);

		const normalizedEmail = input.email.trim().toLowerCase();
		const duplicate = await client.query<{ id: string }>(
			"SELECT id FROM auth_users WHERE LOWER(email) = LOWER($1) LIMIT 1",
			[normalizedEmail],
		);
		if (duplicate.rows.length > 0) {
			throw new CreateUserConflictError();
		}

		const countResult = await client.query<CountRow>(
			"SELECT COUNT(*)::int AS count FROM auth_users",
		);
		const userCount = parseCount(countResult.rows[0]?.count ?? 0);
		const assignedRole: UserRole =
			input.role ?? (userCount === 0 ? "admin" : "apoteker");

		const newUser: UserRecord = {
			id: randomUUID(),
			name: input.name.trim(),
			email: normalizedEmail,
			passwordHash: input.passwordHash,
			role: assignedRole,
			createdAt: new Date().toISOString(),
			nomorRM:
				assignedRole === "pasien" ? await getNextNomorRM(client) : null,
		};

		await client.query(
			`
				INSERT INTO auth_users (
					id,
					name,
					email,
					password_hash,
					role,
					created_at,
					nomor_rm
				) VALUES ($1, $2, $3, $4, $5, $6, $7)
			`,
			[
				newUser.id,
				newUser.name,
				newUser.email,
				newUser.passwordHash,
				newUser.role,
				newUser.createdAt,
				newUser.nomorRM,
			],
		);

		return newUser;
	});
}

export async function deleteUserById(
	userId: string,
	options?: { actorUserId?: string },
): Promise<DeleteUserResult> {
	return withTransaction(async (client) => {
		await lockWrites(client);
		const targetUser = await getUserByIdForUpdate(client, userId);

		if (!targetUser) {
			return { user: null, error: "USER_NOT_FOUND" };
		}

		if (options?.actorUserId && targetUser.id === options.actorUserId) {
			return { user: null, error: "CANNOT_DELETE_SELF" };
		}

		if (targetUser.role === "admin") {
			const countResult = await client.query<CountRow>(
				"SELECT COUNT(*)::int AS count FROM auth_users WHERE role = 'admin'",
			);
			const adminCount = parseCount(countResult.rows[0]?.count ?? 0);
			if (adminCount <= 1) {
				return { user: null, error: "CANNOT_DELETE_LAST_ADMIN" };
			}
		}

		await client.query("DELETE FROM auth_users WHERE id = $1", [userId]);
		return { user: toPublicUser(targetUser), error: null };
	});
}

export async function updateUserPassword(
	userId: string,
	passwordHash: string,
): Promise<UserRecord | null> {
	return withTransaction(async (client) => {
		await lockWrites(client);
		const targetUser = await getUserByIdForUpdate(client, userId);
		if (!targetUser) {
			return null;
		}

		const updatedResult = await client.query<AuthUserRow>(
			`UPDATE auth_users
			 SET password_hash = $2
			 WHERE id = $1
			 RETURNING id, name, email, password_hash, role, created_at, nomor_rm`,
			[userId, passwordHash],
		);

		if (updatedResult.rows.length === 0) {
			return null;
		}

		return mapRowToUserRecord(updatedResult.rows[0]);
	});
}

export async function updateUserRoleById(
	userId: string,
	role: UserRole,
	options?: { actorUserId?: string },
): Promise<UpdateUserRoleResult> {
	if (!isUserRole(role)) {
		return { user: null, error: "INVALID_ROLE" };
	}

	return withTransaction(async (client) => {
		await lockWrites(client);
		const targetUser = await getUserByIdForUpdate(client, userId);
		if (!targetUser) {
			return { user: null, error: "USER_NOT_FOUND" };
		}

		if (options?.actorUserId && targetUser.id === options.actorUserId) {
			return { user: null, error: "CANNOT_CHANGE_SELF_ROLE" };
		}

		if (targetUser.role === "admin" && role !== "admin") {
			const countResult = await client.query<CountRow>(
				"SELECT COUNT(*)::int AS count FROM auth_users WHERE role = 'admin'",
			);
			const adminCount = parseCount(countResult.rows[0]?.count ?? 0);
			if (adminCount <= 1) {
				return { user: null, error: "CANNOT_DEMOTE_LAST_ADMIN" };
			}
		}

		let nextNomorRM: string | null = targetUser.nomorRM;
		if (role === "pasien") {
			if (!nextNomorRM) {
				nextNomorRM = await getNextNomorRM(client, targetUser.id);
			}
		} else {
			nextNomorRM = null;
		}

		const updatedResult = await client.query<AuthUserRow>(
			`UPDATE auth_users
			 SET role = $2,
			     nomor_rm = $3
			 WHERE id = $1
			 RETURNING id, name, email, password_hash, role, created_at, nomor_rm`,
			[userId, role, nextNomorRM],
		);

		if (updatedResult.rows.length === 0) {
			return { user: null, error: "USER_NOT_FOUND" };
		}

		return {
			user: toPublicUser(mapRowToUserRecord(updatedResult.rows[0])),
			error: null,
		};
	});
}