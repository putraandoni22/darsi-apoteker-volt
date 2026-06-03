import { createTool } from "@voltagent/core";
import pg from "pg";
import { z } from "zod";

const { Pool } = pg;

type Icd10Record = {
  kode: string;
  nama: string;
  level: number | null;
  parentKode: string | null;
};

type Icd10QueryRow = {
  kode: string | null;
  nama: string | null;
  level: number | string | null;
  parent_kode: string | null;
};

type Icd10CountRow = {
  total: number | string | null;
};

type Icd10TableConfig = {
  tableExpr: string;
  codeExpr: string;
  nameExpr: string;
  levelExpr: string;
  parentCodeExpr: string;
};

function extractString(val: unknown): string {
  if (typeof val === "string") return val;
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (typeof obj.value === "string") return obj.value;
    if (typeof obj.query === "string") return obj.query;
    if (typeof obj.condition === "string") return obj.condition;
    if (typeof obj.caseQuery === "string") return obj.caseQuery;
    if (obj.description && !obj.value && !obj.query && !obj.condition && !obj.caseQuery) {
      return "";
    }
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

function parseNonNegativeInteger(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function sanitizeIdentifier(input: string, fallback: string): string {
  const normalized = (input || "").trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    return normalized;
  }

  return fallback;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function resolveIcd10TableConfig(): Icd10TableConfig {
  const schema = sanitizeIdentifier(process.env.RSI_ICD10_SCHEMA || "public", "public");
  const table = sanitizeIdentifier(process.env.RSI_ICD10_TABLE || "b_ms_diagnosa", "b_ms_diagnosa");
  const codeColumn = sanitizeIdentifier(process.env.RSI_ICD10_CODE_COLUMN || "kode", "kode");
  const nameColumn = sanitizeIdentifier(process.env.RSI_ICD10_NAME_COLUMN || "nama", "nama");
  const levelColumn = sanitizeIdentifier(process.env.RSI_ICD10_LEVEL_COLUMN || "level", "level");
  const parentCodeColumn = sanitizeIdentifier(
    process.env.RSI_ICD10_PARENT_CODE_COLUMN || "parent_kode",
    "parent_kode",
  );

  return {
    tableExpr: `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`,
    codeExpr: quoteIdentifier(codeColumn),
    nameExpr: quoteIdentifier(nameColumn),
    levelExpr: quoteIdentifier(levelColumn),
    parentCodeExpr: quoteIdentifier(parentCodeColumn),
  };
}

function isListAllIcd10Query(rawQuery: string): boolean {
  const normalized = (rawQuery || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return false;
  }

  if (["*", "all", "semua", "seluruh"].includes(normalized)) {
    return true;
  }

  if (/^(list|daftar)\s+icd(?:-?10)?$/.test(normalized)) {
    return true;
  }

  if (/^icd(?:-?10)?(\s+(all|semua|seluruh))?$/.test(normalized)) {
    return true;
  }

  if (/\b(semua|seluruh|all|list|daftar)\b.*\bicd(?:-?10)?\b/.test(normalized)) {
    return true;
  }

  if (/\bicd(?:-?10)?\b.*\b(semua|seluruh|all|list|daftar)\b/.test(normalized)) {
    return true;
  }

  return false;
}

function extractPageNumberFromQuery(rawQuery: string): number {
  const normalized = (rawQuery || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const pageMatch = normalized.match(/\b(?:halaman|page|pg)\s*(\d+)\b/);
  if (pageMatch?.[1]) {
    return Math.max(Number.parseInt(pageMatch[1], 10) || 1, 1);
  }

  return 1;
}

function normalizeIcd10LookupQuery(rawQuery: string): string {
  const normalized = (rawQuery || "")
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  const explicitCode = normalized.match(/\b([a-z]\d{2}(?:\.\d{1,2})?)\b/i)?.[1];
  if (explicitCode) {
    return explicitCode.toUpperCase();
  }

  const patterns = [
    /(?:nomor|kode)\s+icd(?:-?10)?\s+(?:untuk\s+)?([a-z0-9.\s-]+)/,
    /icd(?:-?10)?\s+(?:untuk\s+)?([a-z0-9.\s-]+)/,
    /(?:nomor|kode)\s+diagnos(?:is|a)\s+([a-z0-9.\s-]+)/,
    /diagnos(?:is|a)\s+([a-z0-9.\s-]+)/,
    /penyakit\s+([a-z0-9.\s-]+)/,
    /kondisi\s+([a-z0-9.\s-]+)/,
  ];

  const stopwords = new Set([
    "mapping",
    "maping",
    "map",
    "tolong",
    "mohon",
    "berikan",
    "cari",
    "nomor",
    "kode",
    "icd",
    "icd10",
    "diagnosis",
    "diagnosa",
    "opsi",
    "terapi",
    "ke",
    "penyakit",
    "kondisi",
    "untuk",
    "tiap",
    "setiap",
    "yang",
    "dan",
    "ini",
    "itu",
  ]);

  const cleanup = (candidate: string): string => {
    const head = candidate.split(/\b(?:dan|untuk|dengan|serta|sesuai|ke|opsi|terapi)\b/)[0] || candidate;
    return head
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
      .filter((token) => !stopwords.has(token))
      .join(" ")
      .trim();
  };

  for (const pattern of patterns) {
    const matched = normalized.match(pattern)?.[1] || "";
    const cleaned = cleanup(matched);
    if (cleaned.length >= 2) {
      return cleaned;
    }
  }

  const fallback = cleanup(normalized);
  return fallback || normalized;
}

function buildIcd10QueryVariants(normalizedQuery: string): string[] {
  const seed = (normalizedQuery || "").trim();
  if (!seed) {
    return [];
  }

  const variants = new Set<string>([seed]);
  const replacements: Array<[RegExp, string]> = [
    [/\bhipertensi\b/g, "hypertension"],
    [/\btekanan\s+darah\s+tinggi\b/g, "hypertension"],
    [/\bdiabetes\s+melitus\b/g, "diabetes mellitus"],
    [/\bdiabetes\s+tipe\s*2\b/g, "type 2 diabetes mellitus"],
    [/\bdm\s+tipe\s*2\b/g, "type 2 diabetes mellitus"],
    [/\bdiabetes\s+tipe\s*1\b/g, "type 1 diabetes mellitus"],
    [/\bdm\s+tipe\s*1\b/g, "type 1 diabetes mellitus"],
    [/\bgagal\s+jantung\b/g, "heart failure"],
    [/\bpenyakit\s+jantung\s+koroner\b/g, "coronary heart disease"],
    [/\basma\b/g, "asthma"],
    [/\btuberkulosis\b/g, "tuberculosis"],
    [/\btbc\b/g, "tuberculosis"],
    [/\bdemam\s+berdarah\b/g, "dengue"],
    [/\bflu\b/g, "influenza"],
  ];

  for (const [pattern, replacement] of replacements) {
    for (const base of Array.from(variants)) {
      if (!pattern.test(base)) {
        continue;
      }

      const replaced = base.replace(pattern, replacement).replace(/\s+/g, " ").trim();
      if (replaced) {
        variants.add(replaced);
      }
    }
  }

  return Array.from(variants);
}

function rankIcd10Records(records: Icd10Record[], normalizedQuery: string): Icd10Record[] {
  const query = normalizedQuery.toLowerCase().trim();
  const queryTokens = query
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  const genericHypertensionQuery =
    /\bhypertension\b/.test(query) &&
    !/\b(portal|secondary|neonatal|pulmonary|gestational|pregnancy|maternal|renovascular|intracranial|endocrine|renal)\b/.test(
      query,
    );

  const scored = records.map((record, index) => {
    const code = (record.kode || "").toLowerCase();
    const name = (record.nama || "").toLowerCase();

    let score = 0;
    if (query && code === query) score += 3000;
    if (query && name === query) score += 1600;
    if (query && name.includes(query)) score += 500;

    if (queryTokens.length > 0) {
      const matched = queryTokens.filter((token) => name.includes(token)).length;
      score += matched * 120;
      if (matched === queryTokens.length) {
        score += 280;
      }
    }

    if (genericHypertensionQuery) {
      if (/^i1[0-5](?:\.|$)/i.test(record.kode)) {
        score += 420;
      }

      if (record.kode.toUpperCase() === "I10") score += 1200;
      if (/essential\s*\(primary\)\s*hypertension|essential\s+primary\s+hypertension/.test(name)) {
        score += 800;
      }

      if (!/^i\d{2}(?:\.|$)/i.test(record.kode) && /hypertension/.test(name)) {
        score -= 320;
      }

      if (/\b(portal|secondary|neonatal|pulmonary|gestational|maternal|renovascular|intracranial|endocrine|renal)\b/.test(name)) {
        score -= 320;
      }
    }

    return { record, score, index };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    const lenA = a.record.nama.length;
    const lenB = b.record.nama.length;
    if (lenA !== lenB) {
      return lenA - lenB;
    }

    return a.index - b.index;
  });

  return scored.map((item) => item.record);
}

function formatIcd10Page(records: Icd10Record[], total: number, limit: number, offset: number): string {
  const lines: string[] = [];

  const start = records.length > 0 ? offset + 1 : 0;
  const end = offset + records.length;

  lines.push(`Total data ICD10 tersedia: ${total}.`);
  lines.push(`Menampilkan ${records.length} data pada baris ${start}-${end}.`);
  lines.push("");

  for (const [index, item] of records.entries()) {
    const absoluteIndex = offset + index + 1;
    lines.push(`${absoluteIndex}. ${item.kode} - ${item.nama}`);

    const meta: string[] = [];
    if (item.level !== null) meta.push(`level ${item.level}`);
    if (item.parentKode) meta.push(`parent ${item.parentKode}`);
    if (meta.length > 0) {
      lines.push(`   (${meta.join(" | ")})`);
    }
  }

  lines.push("");

  const hasPrev = offset > 0;
  const hasNext = end < total;
  const currentPage = Math.floor(offset / limit) + 1;

  if (hasPrev || hasNext) {
    lines.push(`Halaman saat ini: ${currentPage}.`);
  }

  if (hasPrev) {
    lines.push(`Untuk halaman sebelumnya: minta "daftar ICD10 halaman ${Math.max(currentPage - 1, 1)}".`);
  }

  if (hasNext) {
    lines.push(`Untuk halaman berikutnya: minta "daftar ICD10 halaman ${currentPage + 1}".`);
  }

  return lines.join("\n");
}

const pool = new Pool({
  host: process.env.RSI_DB_HOST || process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.RSI_DB_PORT || process.env.PGPORT || 5432),
  database: process.env.RSI_DB_DATABASE || process.env.PGDATABASE || "darsi_icd10",
  user: process.env.RSI_DB_USERNAME || process.env.PGUSER || "postgres",
  password: process.env.RSI_DB_PASSWORD || process.env.PGPASSWORD || "",
  max: Number(process.env.RSI_DB_POOL_MAX || 5),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

async function searchIcd10Records(query: string, limit: number): Promise<Icd10Record[]> {
  const { tableExpr, codeExpr, nameExpr, levelExpr, parentCodeExpr } = resolveIcd10TableConfig();

  const safeLimit = Math.min(Math.max(limit, 1), 20);
  const normalizedQuery = query.trim();
  const codeQuery = normalizedQuery.toUpperCase();
  const wildcardQuery = `%${normalizedQuery.split(/\s+/).filter(Boolean).join("%")}%`;
  const noisyTokens = new Set([
    "mapping",
    "maping",
    "map",
    "opsi",
    "terapi",
    "nomor",
    "kode",
    "icd",
    "icd10",
    "diagnosis",
    "diagnosa",
    "penyakit",
    "kondisi",
    "untuk",
    "dengan",
    "sesuai",
  ]);

  const tokenLikeQuery = normalizedQuery
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !noisyTokens.has(token.toLowerCase()))
    .map((token) => `%${token}%`);
  const tokenArray = tokenLikeQuery.length > 0 ? tokenLikeQuery : [`%${normalizedQuery}%`];

  const sql = `
    SELECT
      CAST(${codeExpr} AS TEXT) AS kode,
      CAST(${nameExpr} AS TEXT) AS nama,
      CAST(${levelExpr} AS INTEGER) AS level,
      CAST(${parentCodeExpr} AS TEXT) AS parent_kode
    FROM ${tableExpr}
    WHERE
      CAST(${nameExpr} AS TEXT) ILIKE $1
      OR CAST(${nameExpr} AS TEXT) ILIKE $2
      OR CAST(${codeExpr} AS TEXT) ILIKE $3
      OR CAST(${nameExpr} AS TEXT) ILIKE ALL($4)
      OR CAST(${nameExpr} AS TEXT) ILIKE ANY($4)
    ORDER BY
      CASE
        WHEN LOWER(CAST(${nameExpr} AS TEXT)) = LOWER($5) THEN 0
        WHEN CAST(${codeExpr} AS TEXT) ILIKE $3 THEN 1
        WHEN CAST(${nameExpr} AS TEXT) ILIKE ALL($4) THEN 2
        WHEN LOWER(CAST(${nameExpr} AS TEXT)) LIKE LOWER($6) THEN 3
        WHEN CAST(${nameExpr} AS TEXT) ILIKE ANY($4) THEN 4
        ELSE 5
      END,
      LENGTH(CAST(${nameExpr} AS TEXT)) ASC,
      CAST(${nameExpr} AS TEXT) ASC
    LIMIT $7
  `;

  const result = await pool.query<Icd10QueryRow>(sql, [
    `%${normalizedQuery}%`,
    wildcardQuery,
    `%${codeQuery}%`,
    tokenArray,
    normalizedQuery,
    `${normalizedQuery}%`,
    safeLimit,
  ]);

  const records = result.rows.map((row: Icd10QueryRow) => ({
    kode: String(row.kode || "").trim(),
    nama: String(row.nama || "").trim(),
    level:
      typeof row.level === "number"
        ? row.level
        : Number.isFinite(Number(row.level))
          ? Number(row.level)
          : null,
    parentKode: row.parent_kode ? String(row.parent_kode).trim() : null,
  }));

  return rankIcd10Records(records, normalizedQuery).slice(0, safeLimit);
}

async function getIcd10TotalCount(): Promise<number> {
  const { tableExpr } = resolveIcd10TableConfig();
  const result = await pool.query<Icd10CountRow>(`SELECT COUNT(*)::BIGINT AS total FROM ${tableExpr}`);
  const raw = result.rows[0]?.total;
  const parsed = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? "0"), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function listIcd10Records(limit: number, offset: number): Promise<Icd10Record[]> {
  const { tableExpr, codeExpr, nameExpr, levelExpr, parentCodeExpr } = resolveIcd10TableConfig();

  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const safeOffset = Math.max(offset, 0);

  const sql = `
    SELECT
      CAST(${codeExpr} AS TEXT) AS kode,
      CAST(${nameExpr} AS TEXT) AS nama,
      CAST(${levelExpr} AS INTEGER) AS level,
      CAST(${parentCodeExpr} AS TEXT) AS parent_kode
    FROM ${tableExpr}
    ORDER BY
      CAST(${codeExpr} AS TEXT) ASC,
      CAST(${nameExpr} AS TEXT) ASC
    LIMIT $1 OFFSET $2
  `;

  const result = await pool.query<Icd10QueryRow>(sql, [safeLimit, safeOffset]);
  return result.rows.map((row: Icd10QueryRow) => ({
    kode: String(row.kode || "").trim(),
    nama: String(row.nama || "").trim(),
    level:
      typeof row.level === "number"
        ? row.level
        : Number.isFinite(Number(row.level))
          ? Number(row.level)
          : null,
    parentKode: row.parent_kode ? String(row.parent_kode).trim() : null,
  }));
}

function formatIcd10Matches(matches: Icd10Record[]): string {
  const lines: string[] = [];
  lines.push(`Ditemukan ${matches.length} data ICD10:`);
  lines.push("");

  for (const [index, item] of matches.entries()) {
    lines.push(`${index + 1}. ${item.kode} - ${item.nama}`);

    const meta: string[] = [];
    if (item.level !== null) meta.push(`level ${item.level}`);
    if (item.parentKode) meta.push(`parent ${item.parentKode}`);
    if (meta.length > 0) {
      lines.push(`   (${meta.join(" | ")})`);
    }
  }

  return lines.join("\n");
}

export const searchIcd10Disease = createTool({
  name: "search_icd_code",
  description:
    "Cari kode/diagnosis penyakit pada database ICD10 PostgreSQL RSI berdasarkan nama penyakit atau kode ICD10. Mendukung daftar seluruh ICD10 dengan query seperti 'daftar semua icd10'.",
  parameters: z.object({
    query: z.preprocess(
      (val) => extractString(val),
      z.string(),
    ).describe("Nama penyakit atau kode ICD10, contoh: diabetes, hipertensi, A00"),
    limit: z
      .preprocess((val) => parseInteger(val, 8), z.number().int().min(1).max(100))
      .optional()
      .describe("Maksimal jumlah hasil per halaman (1-100), default 8"),
    offset: z
      .preprocess((val) => parseNonNegativeInteger(val, 0), z.number().int().min(0).max(1_000_000))
      .optional()
      .describe("Offset data untuk pagination daftar ICD10 (>=0), default 0"),
  }),
  execute: async ({ query, limit, offset }): Promise<string> => {
    try {
      const rawQuery = String(query ?? "").trim();
      const normalized = normalizeIcd10LookupQuery(rawQuery);
      const listAllMode = isListAllIcd10Query(rawQuery);

      if (listAllMode) {
        const envPageSize = parseInteger(process.env.RSI_ICD10_LIST_PAGE_SIZE, 50);
        const defaultPageSize = Math.min(Math.max(envPageSize, 10), 100);
        const effectiveLimit = Math.min(Math.max(limit ?? defaultPageSize, 1), 100);

        const pageFromQuery = extractPageNumberFromQuery(rawQuery);
        const offsetFromPage = Math.max(pageFromQuery - 1, 0) * effectiveLimit;
        const requestedOffset = typeof offset === "number" ? offset : offsetFromPage;

        const total = await getIcd10TotalCount();
        if (total === 0) {
          return "Database ICD10 tersedia tetapi belum memiliki data.";
        }

        const safeOffset = Math.min(Math.max(requestedOffset, 0), Math.max(total - 1, 0));
        const records = await listIcd10Records(effectiveLimit, safeOffset);

        if (records.length === 0) {
          return `Tidak ada data ICD10 pada offset ${safeOffset}.`;
        }

        return formatIcd10Page(records, total, effectiveLimit, safeOffset);
      }

      if (normalized.length < 2) {
        return "Mohon masukkan nama penyakit/kode ICD10 minimal 2 karakter.";
      }

      const searchLimit = Math.min(Math.max(limit ?? 8, 1), 20);

      const variants = buildIcd10QueryVariants(normalized);
      let matches: Icd10Record[] = [];
      for (const variant of variants) {
        matches = await searchIcd10Records(variant, searchLimit);
        if (matches.length > 0) {
          break;
        }
      }

      if (matches.length === 0) {
        return `Penyakit/kode ICD10 "${normalized}" tidak ditemukan di database ICD10 RSI.`;
      }

      return formatIcd10Matches(matches);
    } catch (error) {
      return `Terjadi kesalahan saat mengakses database ICD10: ${String(error)}`;
    }
  },
});
