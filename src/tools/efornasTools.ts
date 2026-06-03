/**
 * Tools for searching e-Fornas (Formularium Nasional) drug database.
 * Uses LanceDB vector embeddings for semantic search.
 */

import { createTool } from "@voltagent/core";
import { z } from "zod";
import { EfornasRetriever, type EfornasSearchResult } from "../embedding/efornasRetriever.js";
import { getEmbeddingHealthReport } from "../embedding/embeddingManager.js";
import * as fs from "fs";
import * as path from "path";
import { getPgPool, qualifyTable, resolveSchema, sanitizeIdentifier } from "../utils/darsiDb.js";

const retriever = new EfornasRetriever(
  process.env.LANCEDB_URI || path.resolve(".voltagent/lancedb")
);

const FORNAS_QUERY_STOPWORDS = new Set([
  "apakah",
  "ada",
  "di",
  "untuk",
  "tolong",
  "mohon",
  "cek",
  "cari",
  "carikan",
  "tampilkan",
  "lihat",
  "informasi",
  "info",
  "ketersediaan",
  "obat",
  "e",
  "fornas",
  "bpjs",
  "formularium",
  "nasional",
  "rsi",
  "dalam",
  "yang",
  "dan",
  "atau",
  "kah",
  "nya",
]);

/**
 * Comprehensive drug name aliases for better search matching
 * Maps common variations to canonical names (Indonesian/English)
 */
const FORNAS_DRUG_ALIASES: Record<string, string> = {
  // Paracetamol variants
  parasetamol: "paracetamol",
  asetaminofen: "paracetamol",
  acetaminophen: "paracetamol",

  // Sodium/Natrium variants
  sodium: "natrium",
  "sodium hyaluronate": "natrium hialuronat",
  "sodium hialorunat": "natrium hialuronat",
  "sodium hialuronat": "natrium hialuronat",
  hialorunat: "hialuronat",
  hialuron: "hialuronat",

  // Ibuprofen variants
  ibupofen: "ibuprofen",
  ibuprophen: "ibuprofen",

  // Common Indonesian/English variations
  amlodipin: "amlodipine",
  atorvastatin: "atorvastatin",
  metformin: "metformin",
  warfarin: "warfarin",
  aspirin: "aspirin",

  // Antibiotics
  amoksisilin: "amoxicillin",
  penisilin: "penicillin",
  eritromisin: "erythromycin",
  azitromisin: "azithromycin",

  // Other common drugs
  simvastatin: "simvastatin",
  losartan: "losartan",
  enalapril: "enalapril",
  furosemid: "furosemide",
};

const FORNAS_QUERY_ALIASES: Record<string, string> = FORNAS_DRUG_ALIASES;

const FORNAS_CATALOG_GENERIC_TOKENS = new Set([
  "informasi",
  "info",
  "data",
  "detail",
  "obat",
  "daftar",
  "list",
  "katalog",
  "lengkap",
  "keseluruhan",
  "seluruh",
  "semua",
  "full",
  "fornas",
  "formularium",
  "bpjs",
  "nasional",
  "rsi",
  "darsi",
  "apoteker",
  "program",
  "database",
]);

type EfornasCatalogRecord = {
  nama_obat: string;
  nama_obat_internasional: string;
  sediaan: string;
  kekuatan: string;
  satuan: string;
  fpktp: string;
  fpktl: string;
  prb: string;
  oen: string;
  program: string;
  restriksi_obat: string;
  peresepan_maksimal: string;
};

let efornasCatalogCache: EfornasCatalogRecord[] | null = null;
const EFORNAS_SCHEMA = resolveSchema("DARSI_EFORNAS_SCHEMA", "darsi_ph_efornas");
const EFORNAS_TABLE = sanitizeIdentifier(process.env.DARSI_EFORNAS_TABLE, "obat_efornas");

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

function mapPgRowToCatalog(row: Record<string, unknown>): EfornasCatalogRecord {
  return {
    nama_obat: cleanField(toText(row.nama_obat), 120),
    nama_obat_internasional: cleanField(toText(row.nama_obat_internasional), 120),
    sediaan: cleanField(toText(row.sediaan), 80),
    kekuatan: cleanField(toText(row.kekuatan), 40),
    satuan: cleanField(toText(row.satuan), 20),
    fpktp: cleanField(toText(row.fpktp), 8),
    fpktl: cleanField(toText(row.fpktl), 8),
    prb: cleanField(toText(row.prb), 8),
    oen: cleanField(toText(row.oen), 8),
    program: cleanField(toText(row.program), 8),
    restriksi_obat: cleanField(toText(row.restriksi_obat), 180),
    peresepan_maksimal: cleanField(toText(row.peresepan_maksimal), 120),
  };
}

function mapPgRowToSearchResult(row: Record<string, unknown>): EfornasSearchResult {
  return {
    id: toText(row.id_obat || row.id),
    nama_obat: toText(row.nama_obat),
    nama_obat_internasional: toText(row.nama_obat_internasional),
    kelas_terapi: toText(row.kelas_terapi),
    sub_kelas_terapi: toText(row.sub_kelas_terapi),
    sub_sub_kelas_terapi: toText(row.sub_sub_kelas_terapi),
    sub_sub_sub_kelas_terapi: toText(row.sub_sub_sub_kelas_terapi),
    sediaan: toText(row.sediaan),
    kekuatan: toText(row.kekuatan),
    satuan: toText(row.satuan),
    fpktp: toText(row.fpktp),
    fpktl: toText(row.fpktl),
    pp: toText(row.pp),
    prb: toText(row.prb),
    oen: toText(row.oen),
    program: toText(row.program),
    kanker: toText(row.kanker),
    komposisi: toText(row.komposisi),
    restriksi_obat: toText(row.restriksi_obat),
    restriksi_sediaan: toText(row.restriksi_sediaan),
    peresepan_maksimal: toText(row.peresepan_maksimal),
    score: 1,
  };
}

async function loadEfornasCatalogFromPg(): Promise<EfornasCatalogRecord[] | null> {
  const pool = getPgPool("DARSI_EFORNAS_DB");
  if (!pool) {
    return null;
  }

  try {
    const tableName = qualifyTable(EFORNAS_SCHEMA, EFORNAS_TABLE);
    const result = await pool.query(
      `SELECT nama_obat, nama_obat_internasional, sediaan, kekuatan, satuan, fpktp, fpktl, prb, oen, program, restriksi_obat, peresepan_maksimal FROM ${tableName} ORDER BY nama_obat ASC`,
    );
    return result.rows.map((row) => mapPgRowToCatalog(row as Record<string, unknown>));
  } catch {
    return null;
  }
}

async function searchEfornasPostgres(query: string, limit = 10): Promise<EfornasSearchResult[]> {
  const pool = getPgPool("DARSI_EFORNAS_DB");
  if (!pool) {
    return [];
  }

  const tableName = qualifyTable(EFORNAS_SCHEMA, EFORNAS_TABLE);
  const normalized = query.toLowerCase().trim();
  if (!normalized) {
    return [];
  }

  const tokens = normalized.split(/\s+/).filter((token) => token.length >= 2);
  const patterns = tokens.length > 0 ? tokens : [normalized];
  const args: string[] = [];
  const clauses: string[] = [];

  for (const token of patterns) {
    const pattern = `%${token}%`;
    const startIndex = args.length + 1;
    args.push(pattern, pattern);
    const nameLike = `LOWER(nama_obat) LIKE $${startIndex}`;
    const intlLike = `LOWER(nama_obat_internasional) LIKE $${startIndex + 1}`;
    clauses.push(`(${nameLike} OR ${intlLike})`);
  }

  args.push(String(limit));
  const limitIndex = args.length;
  const sql = `SELECT * FROM ${tableName} WHERE ${clauses.join(" AND ")} ORDER BY nama_obat ASC LIMIT $${limitIndex}`;

  try {
    const result = await pool.query(sql, args);
    return result.rows.map((row) => mapPgRowToSearchResult(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

async function searchEfornasPostgresByCode(id: string, limit = 5): Promise<EfornasSearchResult[]> {
  const pool = getPgPool("DARSI_EFORNAS_DB");
  if (!pool) {
    return [];
  }

  const normalizedId = id.replace(/[^0-9]/g, "").trim();
  if (!normalizedId) {
    return [];
  }

  const tableName = qualifyTable(EFORNAS_SCHEMA, EFORNAS_TABLE);
  try {
    const result = await pool.query(
      `SELECT * FROM ${tableName} WHERE id_obat = $1 LIMIT $2`,
      [Number(normalizedId), limit],
    );
    return result.rows.map((row) => mapPgRowToSearchResult(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

async function searchEfornasPostgresByKelas(kelas: string, limit = 20): Promise<EfornasSearchResult[]> {
  const pool = getPgPool("DARSI_EFORNAS_DB");
  if (!pool) {
    return [];
  }

  const normalized = kelas.toLowerCase().trim();
  if (!normalized) {
    return [];
  }

  const pattern = `%${normalized}%`;
  const tableName = qualifyTable(EFORNAS_SCHEMA, EFORNAS_TABLE);

  try {
    const result = await pool.query(
      `SELECT * FROM ${tableName}
       WHERE LOWER(kelas_terapi) LIKE $1
          OR LOWER(sub_kelas_terapi) LIKE $1
          OR LOWER(sub_sub_kelas_terapi) LIKE $1
          OR LOWER(sub_sub_sub_kelas_terapi) LIKE $1
       ORDER BY nama_obat ASC
       LIMIT $2`,
      [pattern, limit],
    );
    return result.rows.map((row) => mapPgRowToSearchResult(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  fields.push(current.trim());
  return fields;
}

function joinMultiLineQuotedFields(text: string): string[] {
  const rawLines = text.split(/\r?\n/);
  const joined: string[] = [];
  let accumulator = "";

  for (const line of rawLines) {
    if (accumulator === "") {
      accumulator = line;
    } else {
      accumulator += " " + line;
    }

    let quoteCount = 0;
    for (const ch of accumulator) {
      if (ch === '"') quoteCount++;
    }

    if (quoteCount % 2 === 0) {
      joined.push(accumulator);
      accumulator = "";
    }
  }

  if (accumulator) {
    joined.push(accumulator);
  }

  return joined;
}

function cleanField(value: string, maxLength = 180): string {
  const normalized = String(value || "")
    .replace(/^"|"$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized || normalized === "-") {
    return "informasi belum tersedia";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function parseRequestedPage(rawQuery: string): number {
  const normalized = String(rawQuery || "").toLowerCase();
  const match = normalized.match(/(?:hal(?:aman)?|page)\s*(\d{1,4})/i);
  const page = Number(match?.[1] || "1");
  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.floor(page);
}

async function loadEfornasCatalogRecords(): Promise<EfornasCatalogRecord[]> {
  if (efornasCatalogCache) {
    return efornasCatalogCache;
  }

  const pgRecords = await loadEfornasCatalogFromPg();
  if (pgRecords && pgRecords.length > 0) {
    efornasCatalogCache = pgRecords;
    return pgRecords;
  }

  const csvPath = path.join(process.cwd(), "data", "efornas_obat_lengkap.csv");
  if (!fs.existsSync(csvPath)) {
    return [];
  }

  const text = fs.readFileSync(csvPath, "utf-8");
  const lines = joinMultiLineQuotedFields(text);
  if (lines.length === 0) {
    return [];
  }

  const header = parseCSVLine(lines[0] || "");
  const colIndex: Record<string, number> = {};
  header.forEach((h, i) => {
    if (h) {
      colIndex[h] = i;
    }
  });

  const getCol = (cols: string[], key: string): string => cols[colIndex[key] ?? -1] || "";
  const records: EfornasCatalogRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] || "").trim();
    if (!line) continue;

    const cols = parseCSVLine(line);
    const nama = cleanField(getCol(cols, "nama_obat"), 120);
    if (!nama || nama === "informasi belum tersedia") {
      continue;
    }

    records.push({
      nama_obat: nama,
      nama_obat_internasional: cleanField(getCol(cols, "nama_obat_internasional"), 120),
      sediaan: cleanField(getCol(cols, "sediaan"), 80),
      kekuatan: cleanField(getCol(cols, "kekuatan"), 40),
      satuan: cleanField(getCol(cols, "satuan"), 20),
      fpktp: cleanField(getCol(cols, "fpktp"), 8),
      fpktl: cleanField(getCol(cols, "fpktl"), 8),
      prb: cleanField(getCol(cols, "prb"), 8),
      oen: cleanField(getCol(cols, "oen"), 8),
      program: cleanField(getCol(cols, "program"), 8),
      restriksi_obat: cleanField(getCol(cols, "restriksi_obat"), 180),
      peresepan_maksimal: cleanField(getCol(cols, "peresepan_maksimal"), 120),
    });
  }

  efornasCatalogCache = records;
  return records;
}

function formatFornasLevel(record: EfornasCatalogRecord): string {
  const levels: string[] = [];
  if (record.fpktp === "Ya") levels.push("FKTP");
  if (record.fpktl === "Ya") levels.push("FKTL");
  if (record.prb === "Ya") levels.push("PRB");
  if (record.oen === "Ya") levels.push("OEN");
  if (record.program === "Ya") levels.push("Program Kemenkes");
  return levels.length > 0 ? levels.join(", ") : "informasi belum tersedia";
}

function normalizeFornasLookupQuery(rawQuery: string): string {
  let trimmed = String(rawQuery || "").trim();
  if (!trimmed) {
    return "";
  }

  const quoted = trimmed.match(/["']([^"']+)["']/)?.[1]?.trim();
  if (quoted) {
    return quoted;
  }

  // First: Apply multi-word aliases (e.g., "sodium hialorunat" → "natrium hialuronat")
  for (const [from, to] of Object.entries(FORNAS_DRUG_ALIASES)) {
    if (from.includes(" ")) {
      // Case-insensitive replacement of multi-word aliases
      trimmed = trimmed.toLowerCase().replace(new RegExp(`\\b${from}\\b`, "gi"), to);
    }
  }

  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !FORNAS_QUERY_STOPWORDS.has(token))
    .map((token) => FORNAS_DRUG_ALIASES[token] || token);

  if (tokens.length === 0) {
    return trimmed;
  }

  return tokens.slice(0, 8).join(" ").trim();
}

function isFullFornasCatalogIntent(rawQuery: string): boolean {
  const normalized = String(rawQuery || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return false;
  }

  if (/\b(keseluruhan|seluruh|semua)\s+data\s+obat\b/.test(normalized)) {
    return true;
  }

  if (/\bdaftar\s+lengkap\s+obat\b/.test(normalized)) {
    return true;
  }

  const hasFornasContext = /\b(e\s*fornas|fornas|formularium|bpjs)\b/.test(normalized);
  const hasCatalogTerm = /(semua|seluruh|keseluruhan|daftar|list|katalog|lengkap|full)/.test(normalized);
  const hasDataTerm = /(obat|database|data|fornas|formularium|bpjs)/.test(normalized);

  if (!(hasCatalogTerm && hasDataTerm)) {
    return false;
  }

  if (hasFornasContext) {
    return true;
  }

  const lookupQuery = normalizeFornasLookupQuery(rawQuery)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const specificTokens = lookupQuery
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  if (specificTokens.length === 0) {
    return true;
  }

  return specificTokens.every((token) => FORNAS_CATALOG_GENERIC_TOKENS.has(token));
}

async function formatFullEfornasCatalog(rawQuery: string): Promise<string> {
  const records = await loadEfornasCatalogRecords();
  if (records.length === 0) {
    return "Data e-Fornas belum tersedia di server. Mohon jalankan sinkronisasi data terlebih dahulu.";
  }

  const pageSize = 20;
  const requestedPage = parseRequestedPage(rawQuery);
  const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
  const currentPage = Math.min(Math.max(requestedPage, 1), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const pageItems = records.slice(startIndex, startIndex + pageSize);
  const uniqueNames = new Set(records.map((record) => record.nama_obat.toLowerCase())).size;

  const sanitizeCell = (value: string): string =>
    String(value || "informasi belum tersedia").replace(/\|/g, "∣").trim();

  const lines: string[] = [];
  lines.push("DAFTAR LENGKAP OBAT e-Fornas");
  lines.push(`Total entri: ${records.length}`);
  lines.push(`Total obat unik: ${uniqueNames}`);
  lines.push(`Halaman: ${currentPage}/${totalPages} (menampilkan ${pageItems.length} entri)`);
  lines.push("");

  lines.push("| No | Nama Obat | Bentuk Sediaan | Dosis / Kekuatan | Sumber Data |");
  lines.push("|---|---|---|---|---|");

  for (let i = 0; i < pageItems.length; i++) {
    const record = pageItems[i];
    if (!record) continue;

    const rowNumber = startIndex + i + 1;
    const nama = sanitizeCell(record.nama_obat);
    const bentuk = sanitizeCell(record.sediaan);
    const dosisText = [record.kekuatan, record.satuan]
      .filter((value) => value && value !== "informasi belum tersedia")
      .join(" ");
    const dosis = sanitizeCell(dosisText);
    lines.push(`| ${rowNumber} | ${nama} | ${bentuk} | ${dosis} | e-Fornas |`);
  }

  lines.push("");
  if (currentPage < totalPages) {
    lines.push(`Untuk lanjut, tulis: "tampilkan data e-Fornas halaman ${currentPage + 1}".`);
  } else {
    lines.push("Semua halaman data e-Fornas sudah ditampilkan.");
  }

  return lines.join("\n");
}

function hasEfornasKeywordMatch(result: EfornasSearchResult, keywords: string[]): boolean {
  if (keywords.length === 0) {
    return true;
  }

  const haystack = [
    result.nama_obat,
    result.nama_obat_internasional,
    result.kelas_terapi,
    result.sub_kelas_terapi,
    result.sub_sub_kelas_terapi,
    result.sub_sub_sub_kelas_terapi,
    result.komposisi,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return keywords.some((keyword) => haystack.includes(keyword));
}

// ─── MARKDOWN TABLE FORMATTER ──────────────────────────────
/**
 * Formats e-Fornas drug search results as a Markdown table.
 * Table is pre-formatted and MUST NOT be modified by LLM.
 */
function formatEfornasResultsAsMarkdownTable(results: EfornasSearchResult[]): string {
  if (!results || results.length === 0) {
    return "Obat tidak ditemukan dalam database e-Fornas.";
  }

  const lines: string[] = [];
  
  // Header
  lines.push("| No | Nama Obat | Bentuk Sediaan | Dosis / Kekuatan | Sumber Data |");
  lines.push("|---|---|---|---|---|");
  
  // Rows - deduplicate by name to avoid repetition
  const seen = new Set<string>();
  let rowNum = 1;
  
  for (const r of results) {
    const nama = (r.nama_obat || "-").replace(/\|/g, "∣").trim();
    
    // Skip if already shown (prevent repetition)
    if (seen.has(nama)) continue;
    seen.add(nama);
    
    if (rowNum > 10) break;
    
    const bentuk = (r.sediaan || "-").replace(/\|/g, "∣").slice(0, 25);
    const dosis = (r.kekuatan || "-").replace(/\|/g, "∣").slice(0, 30);
    const sumber = "e-Fornas";
    
    lines.push(`| ${rowNum} | ${nama} | ${bentuk} | ${dosis} | ${sumber} |`);
    rowNum++;
  }
  
  // Footer
  lines.push("");
  lines.push(`**Total: ${seen.size} hasil** | Sumber: e-Fornas (Formularium Nasional)`);
  
  return lines.join("\n");
}

async function checkEfornasBackend(): Promise<{ retriever: boolean; postgres: boolean }> {
  const status = { retriever: false, postgres: false };

  try {
    status.retriever = await retriever.isAvailable();
  } catch {
    status.retriever = false;
  }

  if (!status.retriever) {
    try {
      const pool = getPgPool("DARSI_EFORNAS_DB");
      if (pool) {
        const tableName = qualifyTable(EFORNAS_SCHEMA, EFORNAS_TABLE);
        const result = await pool.query(`SELECT 1 AS ok FROM ${tableName} LIMIT 1`);
        status.postgres = result.rows.length > 0;
      }
    } catch {
      status.postgres = false;
    }
  }

  if (status.retriever) {
    status.postgres = true;
  }

  return status;
}

// Check availability IN tools (not on module load) to avoid race conditions
async function checkEfornas(): Promise<boolean> {
  const status = await checkEfornasBackend();
  return status.retriever || status.postgres;
}

// ─── FORMAT HELPER ───────────────────────────────────────────

function formatEfornasResult(result: EfornasSearchResult): string {
  const lines: string[] = [];
  lines.push(`📌 ${result.nama_obat}`);

  if (result.nama_obat_internasional) {
    lines.push(`   Nama Internasional: ${result.nama_obat_internasional}`);
  }

  // Kelas terapi chain
  const kelas = [
    result.kelas_terapi,
    result.sub_kelas_terapi,
    result.sub_sub_kelas_terapi,
    result.sub_sub_sub_kelas_terapi,
  ].filter(Boolean);
  if (kelas.length > 0) {
    lines.push(`   Kelas Terapi: ${kelas.join(" → ")}`);
  }

  // Sediaan
  if (result.sediaan) {
    lines.push(`   Sediaan: ${result.sediaan} ${result.kekuatan} ${result.satuan}`);
  }

  if (result.komposisi) {
    lines.push(`   Komposisi: ${result.komposisi}`);
  }

  // Level faskes
  const levels: string[] = [];
  if (result.fpktp === "Ya") levels.push("FKTP");
  if (result.fpktl === "Ya") levels.push("FKTL");
  if (result.prb === "Ya") levels.push("PRB");
  if (result.oen === "Ya") levels.push("OEN");
  if (result.program === "Ya") levels.push("Program Kemenkes");
  if (levels.length > 0) {
    lines.push(`   Tersedia di: ${levels.join(", ")}`);
  }

  if (result.restriksi_obat) {
    lines.push(`   Restriksi: ${result.restriksi_obat}`);
  }

  if (result.peresepan_maksimal) {
    lines.push(`   Peresepan Maksimal: ${result.peresepan_maksimal}`);
  }

  return lines.join("\n");
}

function deduplicateByName(results: EfornasSearchResult[]): EfornasSearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = [
      r.nama_obat,
      r.sediaan,
      r.kekuatan,
      r.satuan,
    ]
      .join("|")
      .toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── PARAM HELPER ────────────────────────────────────────────
// LLM sometimes sends {"value": "x"} or {"description": "..."} instead of "x"
// We need to robustly extract the actual query string
function extractString(val: unknown): string {
  if (typeof val === "string") return val;
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (typeof obj.value === "string") return obj.value;
    // LLM sent the schema description instead of actual value — return empty
    if (obj.description && !obj.value) return "";
  }
  return String(val ?? "");
}

// ─── TOOLS ───────────────────────────────────────────────────

export const searchEfornasObat = createTool({
  name: "search-efornas",
  description:
    "Search drugs in e-Fornas (National Formularium) database. RETURNS PRE-FORMATTED MARKDOWN TABLE with columns: No | Nama Obat | Bentuk Sediaan | Dosis/Kekuatan | Sumber Data. YOU MUST pass this table directly to the user WITHOUT converting to list format. Parameter: query (drug name as STRING, e.g., 'amoxicillin' or 'EFR-1666' for code lookup).",
  parameters: z.object({
    query: z.preprocess(
      (val) => extractString(val),
      z.string()
    ).describe("nama obat, contoh: amoxicillin"),
  }),
  execute: async ({ query }): Promise<string> => {
    try {
      const q = (query ?? "").trim();
      const lookupQuery = normalizeFornasLookupQuery(q);
      const lookupKeywords = lookupQuery
        .toLowerCase()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3);

      if (!q || q.length < 2) {
        return "Mohon masukkan nama obat yang lebih spesifik (minimal 2 karakter).";
      }

      if (isFullFornasCatalogIntent(q)) {
        return await formatFullEfornasCatalog(q);
      }

      const backendStatus = await checkEfornasBackend();
      if (!backendStatus.retriever && !backendStatus.postgres) {
        return "Database e-Fornas belum tersedia. Hubungi administrator untuk menjalankan inisialisasi.";
      }

      // Get embedding health status for better fallback messaging
      const embeddingHealth = await getEmbeddingHealthReport();
      let results: EfornasSearchResult[] = [];
      let searchModeUsed = "";

      // Step 1: Detect if query is a code/ID lookup (e.g., "1666", "EFR-01666", "nomor efr-01666")
      const codeMatch = q.match(/(?:nomor\s+)?(?:efr[-\s]?)?(\d{3,5})/i);
      const code = codeMatch?.[1];
      if (code) {
        if (backendStatus.retriever) {
          results = await retriever.searchById(code, 5);
          searchModeUsed = "code-lookup";
        }

        if (results.length === 0 && backendStatus.postgres) {
          results = await searchEfornasPostgresByCode(code, 5);
          searchModeUsed = "code-lookup-postgres";
        }

        if (results.length > 0) {
          return formatEfornasResultsAsMarkdownTable(results);
        }
      }

      // Step 2: Try fuzzy name search first (better handling of synonyms & typos)
      if (backendStatus.retriever) {
        results = await retriever.searchByNameFuzzy(lookupQuery || q, 10);
        if (results.length > 0) {
          searchModeUsed = "fuzzy-match";
        }
      }

      if (results.length === 0 && backendStatus.postgres) {
        results = await searchEfornasPostgres(lookupQuery || q, 10);
        if (results.length > 0) {
          searchModeUsed = "fuzzy-match-postgres";
        }
      }

      // Step 3: If no results from fuzzy search, try semantic search (if embeddings available)
      if (results.length === 0 && backendStatus.retriever && embeddingHealth.isFresh) {
        try {
          const semanticResults = await retriever.search(lookupQuery || q, 10);
          const MIN_SEMANTIC_SCORE = 0.4;
          const highScoreResults = semanticResults.filter((r) => (r.score ?? 0) >= MIN_SEMANTIC_SCORE);
          const keywordMatched = highScoreResults.filter((r) => hasEfornasKeywordMatch(r, lookupKeywords));
          results = keywordMatched.length > 0 ? keywordMatched : highScoreResults;
          if (results.length > 0) {
            searchModeUsed = "semantic-search";
          }
        } catch (semanticError) {
          // Fallback to exact match only
          searchModeUsed = "exact-match-fallback";
        }
      } else if (results.length === 0) {
        searchModeUsed = backendStatus.postgres ? "exact-match-postgres" : "exact-match-only";
      }

      results = deduplicateByName(results).slice(0, 10);

      if (results.length === 0) {
        const modeInfo = embeddingHealth.isFresh 
          ? "[Mode: Exact matching dan fuzzy search]" 
          : `[Mode: Exact matching - Embedding system ${embeddingHealth.status}]`;
        return `Obat "${q}" tidak ditemukan di database e-Fornas. ${modeInfo}\n\nCoba: 1) nama obat yang lebih spesifik, 2) nama generik/internasional (misal: Paracetamol bukan Termorex), 3) atau nomor EFR jika diketahui.`;
      }

      // Return pre-formatted Markdown table (DO NOT MODIFY)
      return formatEfornasResultsAsMarkdownTable(results);
    } catch (error) {
      // Silent error - return fallback message
      return "Terjadi kesalahan saat mencari obat di e-Fornas.";
    }
  },
});

export const searchEfornasKelas = createTool({
  name: "search-efornas-kelas",
  description:
    "Cari obat di e-Fornas berdasarkan kelas terapi. Parameter kelas adalah STRING. Contoh: search-efornas-kelas({kelas: \"antibiotik\"})",
  parameters: z.object({
    kelas: z.preprocess(
      (val) => extractString(val),
      z.string()
    ).describe("kelas terapi, contoh: antibiotik"),
  }),
  execute: async ({ kelas }): Promise<string> => {
    try {
      const q = (kelas ?? "").trim();
      if (!q || q.length < 2) {
        return "Mohon masukkan kelas terapi yang lebih spesifik.";
      }

      const backendStatus = await checkEfornasBackend();
      if (!backendStatus.retriever && !backendStatus.postgres) {
        return "Database e-Fornas belum tersedia. Hubungi administrator untuk menjalankan inisialisasi.";
      }

      const results = backendStatus.retriever
        ? await retriever.searchByKelas(q, 30)
        : await searchEfornasPostgresByKelas(q, 30);

      if (results.length === 0) {
        return `Tidak ditemukan obat untuk kelas terapi "${q}" di e-Fornas.`;
      }

      const keywords = q
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((k) => k.length >= 3);

      const filtered = results.filter((r) => {
        const classText = [
          r.kelas_terapi,
          r.sub_kelas_terapi,
          r.sub_sub_kelas_terapi,
          r.sub_sub_sub_kelas_terapi,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        const nameText = `${r.nama_obat} ${r.nama_obat_internasional}`.toLowerCase();
        return keywords.some((kw) => classText.includes(kw) || nameText.includes(kw));
      });

      if (filtered.length === 0) {
        return `Tidak ditemukan obat untuk kelas terapi "${q}" di e-Fornas.`;
      }

      // Deduplicate by drug name for cleaner output
      const unique = deduplicateByName(filtered).slice(0, 15);

      const lines: string[] = [];
      lines.push(
        `Obat kelas terapi "${q}" di e-Fornas (${unique.length} obat):`
      );
      lines.push("");
      lines.push(
        "⚠️ CATATAN: Data dari Formularium Nasional. Keputusan penggunaan obat harus sesuai resep dokter."
      );
      lines.push("");

      for (const result of unique) {
        if (result) {
          lines.push(formatEfornasResult(result));
          lines.push("");
        }
      }

      return lines.join("\n");
    } catch (error) {
      // Silent error - return fallback message
      return "Terjadi kesalahan saat mencari kelas terapi di e-Fornas.";
    }
  },
});

export { checkEfornas };
