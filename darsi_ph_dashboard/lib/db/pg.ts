import "server-only";

import pg from "pg";

const { Pool } = pg;

type PoolConfig = pg.PoolConfig;

const poolCache = new Map<string, pg.Pool>();

function getEnvValue(key: string): string | undefined {
	const value = process.env[key];
	return value && value.trim().length > 0 ? value.trim() : undefined;
}

function resolveBooleanEnv(value: string | undefined): boolean {
	if (!value) {
		return false;
	}
	return value.toLowerCase() === "true" || value === "1";
}

export function resolvePgConfig(prefix = "DARSI_DB"): PoolConfig | null {
	const url = getEnvValue(`${prefix}_URL`);
	const sslEnabled = resolveBooleanEnv(getEnvValue(`${prefix}_SSL`));

	if (url) {
		return {
			connectionString: url,
			...(sslEnabled ? { ssl: { rejectUnauthorized: false } } : {}),
		};
	}

	const host = getEnvValue(`${prefix}_HOST`);
	if (!host) {
		return null;
	}

	const port = Number(getEnvValue(`${prefix}_PORT`) || 5432);
	const database =
		getEnvValue(`${prefix}_DATABASE`) ||
		getEnvValue(`${prefix}_NAME`) ||
		"hospital_cs";
	const user =
		getEnvValue(`${prefix}_USERNAME`) ||
		getEnvValue(`${prefix}_USER`) ||
		"postgres";
	const password = getEnvValue(`${prefix}_PASSWORD`) || "";

	return {
		host,
		port: Number.isFinite(port) ? port : 5432,
		database,
		user,
		password,
		...(sslEnabled ? { ssl: { rejectUnauthorized: false } } : {}),
	};
}

export function getPgPool(prefix = "DARSI_DB"): pg.Pool | null {
	const config = resolvePgConfig(prefix);
	if (!config) {
		return null;
	}

	const cached = poolCache.get(prefix);
	if (cached) {
		return cached;
	}

	const pool = new Pool(config);
	poolCache.set(prefix, pool);
	return pool;
}

export function isPgDispensingEnabled(): boolean {
	if (resolveBooleanEnv(getEnvValue("DARSI_DISPENSING_USE_SQLITE"))) {
		return false;
	}
	return getPgPool("DARSI_DB") !== null;
}

export function quoteIdentifier(identifier: string): string {
	return `"${identifier.replace(/"/g, '""')}"`;
}

export function resolveDispensingTableName(): string {
	const raw = getEnvValue("DARSI_DISPENSING_TABLE")?.trim();
	if (raw && /^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) {
		return raw;
	}
	return "darsi_ph_dispensing";
}
