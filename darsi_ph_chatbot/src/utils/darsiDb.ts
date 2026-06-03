import pg from "pg";

const { Pool } = pg;

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

type PoolConfig = pg.PoolConfig;

const poolCache = new Map<string, pg.Pool>();

function getEnvValue(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function resolveBooleanEnv(value: string | undefined): boolean {
  if (!value) return false;
  return value.toLowerCase() === "true" || value === "1";
}

function resolvePrefixedEnv(prefix: string | undefined, suffix: string): string | undefined {
  if (prefix) {
    const prefixed = getEnvValue(`${prefix}_${suffix}`);
    if (prefixed) return prefixed;
  }

  return getEnvValue(`DARSI_DB_${suffix}`);
}

export function resolvePgConfig(prefix?: string): PoolConfig | null {
  const envPrefix = prefix?.trim();
  const url = resolvePrefixedEnv(envPrefix, "URL");
  const sslEnabled = resolveBooleanEnv(resolvePrefixedEnv(envPrefix, "SSL"));

  if (url) {
    return {
      connectionString: url,
      ...(sslEnabled ? { ssl: { rejectUnauthorized: false } } : {}),
    } satisfies PoolConfig;
  }

  const host = resolvePrefixedEnv(envPrefix, "HOST");
  if (!host) {
    return null;
  }

  const port = Number(resolvePrefixedEnv(envPrefix, "PORT") || 5432);
  const database =
    resolvePrefixedEnv(envPrefix, "DATABASE") ||
    resolvePrefixedEnv(envPrefix, "NAME") ||
    "hospital_cs";
  const user =
    resolvePrefixedEnv(envPrefix, "USERNAME") ||
    resolvePrefixedEnv(envPrefix, "USER") ||
    "postgres";
  const password = resolvePrefixedEnv(envPrefix, "PASSWORD") || "";

  return {
    host,
    port: Number.isFinite(port) ? port : 5432,
    database,
    user,
    password,
    ...(sslEnabled ? { ssl: { rejectUnauthorized: false } } : {}),
  } satisfies PoolConfig;
}

export function getPgPool(prefix = "DARSI_DB"): pg.Pool | null {
  const config = resolvePgConfig(prefix);
  if (!config) {
    return null;
  }

  const cacheKey = prefix || "DARSI_DB";
  const cached = poolCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pool = new Pool(config);
  poolCache.set(cacheKey, pool);
  return pool;
}

export function sanitizeIdentifier(value: string | undefined, fallback: string): string {
  const normalized = (value || "").trim();
  if (normalized && SAFE_IDENTIFIER.test(normalized)) {
    return normalized;
  }

  return fallback;
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function qualifyTable(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

export function resolveSchema(envKey: string, fallback: string): string {
  return sanitizeIdentifier(getEnvValue(envKey), fallback);
}
