import { createTool } from "@voltagent/core";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import {
  getPgPool,
  qualifyTable,
  quoteIdentifier,
  resolveSchema,
  sanitizeIdentifier,
} from "../utils/darsiDb.js";

// ─── TYPES ───────────────────────────────────────────────────
export type KronisObat = {
  no: string;
  nama: string;
  restriksi: string;
  peresepan: string;
  smf: string;
  isVariant: boolean; // true if sub-entry of a numbered medicine (e.g., ALLOPURINOL 300MG under #1)
};

// ─── QUOTE-AWARE CSV PARSER ──────────────────────────────────
/**
 * Splits a CSV line by semicolon (;) but respects content inside double quotes.
 * This prevents splitting on semicolons that appear within quoted fields.
 * 
 * Example: "Field 1","Field;With;Semicolons","Field 3"
 *         Will produce: ["Field 1", "Field;With;Semicolons", "Field 3"]
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === ";" && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  
  fields.push(current.trim());
  return fields;
}

/**
 * Removes surrounding double quotes from a CSV field value.
 * Example: `"value"` becomes `value`
 */
function unquote(str: string): string {
  str = str.trim();
  if (str.startsWith('"') && str.endsWith('"')) {
    return str.slice(1, -1).trim();
  }
  return str;
}

function normalizeColumnKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function resolveRowKey(
  row: Record<string, unknown>,
  candidates: string[],
): string | undefined {
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, candidate)) {
      return candidate;
    }
  }

  const normalizedMap = new Map<string, string>();
  for (const key of Object.keys(row)) {
    normalizedMap.set(normalizeColumnKey(key), key);
  }

  for (const candidate of candidates) {
    const resolved = normalizedMap.get(normalizeColumnKey(candidate));
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

function getRowValue(row: Record<string, unknown>, candidates: string[]): unknown {
  const resolvedKey = resolveRowKey(row, candidates);
  if (!resolvedKey) {
    return undefined;
  }

  return row[resolvedKey];
}

// ─── CSV LOADER WITH FILL-DOWN LOGIC ───────────────────────
/**
 * Loads all chronic medicines from CSV into memory cache.
 * 
 * FILL-DOWN LOGIC:
 * If a row has no medicine name (col 1) but has restriction info (col 2),
 * it's treated as a continuation of the previous row.
 * Append its restriction text to the previous entry's restriction.
 * 
 * CSV Format:
 * NO.;NAMA OBAT;RESTRIKSI/JENIS OBAT;PERESEPAN MAKSIMAL;SMF
 * 
 * Example:
 * 1;ALLOPURINOL 100MG;Tidak diberikan pada saat nyeri akut;30 TAB/BULAN;P. DALAM
 *  ;ALLOPURINOL 300MG;;60 TAB/BULAN;           <- Continuation (same peresepan logic)
 *  ;     ;Atau kondisi lain...;             <- Continuation (append to restriksi)
 */
let cache: KronisObat[] | null = null;
const KRONIS_SCHEMA = resolveSchema("DARSI_KRONIS_SCHEMA", "darsi_ph_kronis");
const KRONIS_TABLE = sanitizeIdentifier(process.env.DARSI_KRONIS_TABLE, "obat_kronis");

/**
 * Pre-process CSV text to join multi-line quoted fields.
 * Some fields (e.g., WARFARIN #24, SOROQUIN #95) have newlines inside quoted values.
 * This function joins those split lines before row-by-row parsing.
 */
function joinMultiLineQuotedFields(text: string): string[] {
  const rawLines = text.split(/\r?\n/);
  const joined: string[] = [];
  let accumulator = "";

  for (const line of rawLines) {
    if (accumulator === "") {
      accumulator = line;
    } else {
      // Join continuation of a multi-line quoted field
      accumulator += " " + line;
    }

    // Count unescaped quotes - if even, all fields are closed
    let quoteCount = 0;
    for (const ch of accumulator) {
      if (ch === '"') quoteCount++;
    }

    if (quoteCount % 2 === 0) {
      joined.push(accumulator);
      accumulator = "";
    }
  }

  // Push any remaining content
  if (accumulator) {
    joined.push(accumulator);
  }

  return joined;
}

async function loadAllKronis(): Promise<KronisObat[]> {
  if (cache) return cache;

  const pool = getPgPool("DARSI_KRONIS_DB");
  if (pool) {
    try {
      const tableName = qualifyTable(KRONIS_SCHEMA, KRONIS_TABLE);
      const sample = await pool.query(`SELECT * FROM ${tableName} LIMIT 1`);
      const sampleRow = sample.rows?.[0] as Record<string, unknown> | undefined;
      const orderKey = sampleRow ? resolveRowKey(sampleRow, ["id"]) : undefined;
      const orderClause = orderKey ? ` ORDER BY ${quoteIdentifier(orderKey)} ASC` : "";

      const result = await pool.query(`SELECT * FROM ${tableName}${orderClause}`);

      const rows = result.rows as Array<Record<string, unknown>>;
      const mapped: KronisObat[] = [];
      let lastEntry: KronisObat | null = null;

      for (const row of rows) {
        const no = String(
          getRowValue(row, ["no", "nomor", "no_obat", "noobat"]) ?? "",
        ).trim();
        const nama = String(
          getRowValue(row, ["nama_obat", "nama", "namaobat"]) ?? "",
        )
          .trim()
          .replace(/\*/g, "");
        const restriksi = String(
          getRowValue(row, ["restriksi", "restriksi_obat", "restriksiobat"])
            ?? "",
        ).trim();
        const peresepan = String(
          getRowValue(row, [
            "peresepan_maksimal",
            "peresepan",
            "peresepan_maks",
            "peresepanmaksimal",
            "peresepanMaksimal",
            "pereSepanMaksimal",
          ]) ?? "",
        ).trim();
        const smf = String(
          getRowValue(row, ["smf", "smf_unit", "smf_poli"]) ?? "",
        ).trim();

        if (nama && no) {
          const entry: KronisObat = {
            no,
            nama,
            restriksi: restriksi || "-",
            peresepan: peresepan || "-",
            smf: smf || "-",
            isVariant: false,
          };

          mapped.push(entry);
          lastEntry = entry;
        } else if (nama && !no && lastEntry) {
          const entry: KronisObat = {
            no: lastEntry.no,
            nama,
            restriksi: restriksi || lastEntry.restriksi,
            peresepan: peresepan || lastEntry.peresepan,
            smf: smf || lastEntry.smf,
            isVariant: true,
          };

          mapped.push(entry);
          lastEntry = entry;
        } else if (!nama && restriksi && lastEntry) {
          if (lastEntry.restriksi === "-") {
            lastEntry.restriksi = restriksi;
          } else {
            lastEntry.restriksi += " " + restriksi;
          }
        }
      }

      cache = mapped;
      return mapped;
    } catch {
      // Fall back to CSV parsing if database lookup fails.
    }
  }

  const csvPath = path.join(
    process.cwd(),
    "data",
    "DAFTAR OBAT KRONIS RSI SURABAYA.csv"
  );

  if (!fs.existsSync(csvPath)) {
    // CSV not found - return empty array, will use fallback
    return [];
  }

  const text = fs.readFileSync(csvPath, "utf-8");
  // Pre-process: join multi-line quoted fields before parsing
  const lines = joinMultiLineQuotedFields(text);
  const result: KronisObat[] = [];
  let lastEntry: KronisObat | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    
    // Skip empty lines
    if (!line) continue;
    
    // Skip header rows
    if (line.startsWith("DAFTAR")) continue;
    if (line.startsWith("NO.")) continue;

    // Parse CSV line (quote-aware)
    const cols = splitCsvLine(line);
    
    const no = unquote(cols[0] ?? "").trim();
    const nama = unquote(cols[1] ?? "").trim().replace(/\*/g, "");
    const restriksi = unquote(cols[2] ?? "").trim();
    const peresepan = unquote(cols[3] ?? "").trim();
    const smf = unquote(cols[4] ?? "").trim();

    if (nama && no) {
      // === NEW NUMBERED MEDICINE ENTRY ===
      const entry: KronisObat = {
        no,
        nama,
        restriksi: restriksi || "-",
        peresepan: peresepan || "-",
        smf: smf || "-",
        isVariant: false,
      };
      
      result.push(entry);
      lastEntry = entry;
    } else if (nama && !no && lastEntry) {
      // === VARIANT ROW (no number, has name) ===
      // This is a dosage variant of the previous medicine (e.g., ALLOPURINOL 300MG under #1)
      const entry: KronisObat = {
        no: lastEntry.no,
        nama,
        restriksi: restriksi || lastEntry.restriksi,
        peresepan: peresepan || lastEntry.peresepan,
        smf: smf || lastEntry.smf,
        isVariant: true,
      };
      
      result.push(entry);
      lastEntry = entry;
    } else if (!nama && restriksi && lastEntry) {
      // === FILL-DOWN LOGIC ===
      // Continuation row: no name, but has restriction info
      // Append the restriction text to the last entry
      if (lastEntry.restriksi === "-") {
        lastEntry.restriksi = restriksi;
      } else {
        lastEntry.restriksi += " " + restriksi;
      }
    }
  }

  cache = result;
  
  // Silent initialization - no logging
  
  return result;
}

// ─── SEARCH HELPERS ─────────────────────────────────────────

/**
 * Normalize string for searching:
 * - Convert to lowercase
 * - Remove special characters (keep only alphanumeric + space)
 * - Trim whitespace
 */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

/**
 * Stop words that are excluded from keyword matching.
 * These are common Indonesian words that don't add search value.
 */
const STOP_WORDS = new Set([
  "ada", "apakah", "apa", "cari", "carikan", "info", "informasi",
  "obat", "untuk", "yang", "di", "dari", "tentang", "tolong",
  "mau", "tanya", "saya", "aku", "bisa", "kah", "gak", "tidak",
  "dong", "deh", "ya", "nih", "tau", "tahu", "gimana", "mana",
  "ini", "itu", "lah", "sih", "nya", "kan", "juga", "dong",
  "punya", "ada", "mi", "ma", "am", "es", "no",
]);

/**
 * Extract meaningful keywords from input.
 * Removes stop words and short tokens (< 2 chars).
 */
function extractKeywords(input: string): string[] {
  return norm(input)
    .split(/\s+/)
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w));
}

/**
 * Search medicines with intelligent scoring system.
 * 
 * Scoring:
 * - Exact match (normalized): +1000
 * - Substring match: +100
 * - Each keyword match: +10
 * 
 * Returns sorted list by relevance score (highest first).
 * Only returns entries with score > 0.
 */
function searchMedicinesHelper(
  data: KronisObat[],
  query: string
): KronisObat[] {
  if (!query || query.length < 2) {
    return [];
  }

  const q = norm(query);
  const keywords = extractKeywords(query);

  // If no meaningful keywords and query is short, return empty
  if (keywords.length === 0 && q.length < 2) {
    return [];
  }

  // Score each medicine entry
  const scored = data.map(obat => {
    const nameNorm = norm(obat.nama);
    let score = 0;

    // Rule 1: Exact match (normalized form)
    if (nameNorm === q) {
      score += 1000;
    }
    // Rule 2: Substring match
    else if (nameNorm.includes(q)) {
      score += 100;
    }

    // Rule 3: Keyword matching
    for (const kw of keywords) {
      if (nameNorm.includes(kw)) {
        score += 10;
      }
    }

    return { obat, score };
  });

  // Filter entries with score > 0 and sort by score (descending)
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.obat);
}

// ─── TOOL 1: GET AGENT PROFILE ──────────────────────────────
/**
 * Returns fixed profile information about DARSI Apoteker.
 * 
 * Key characteristics:
 * - Fixed output (no variation possible)
 * - Empty parameters (z.object({})) = cannot be customized by LLM
 * - Used when user asks: "siapa kamu", "profil", "tentang", "bisa apa"
 */
export const getAgentProfile = createTool({
  name: "get-agent-profile",
  description:
    "Get DARSI Apoteker profile (identity, capabilities, limitations). Output is FIXED.",
  parameters: z.object({}),
  execute: async (): Promise<string> => {
    const data = await loadAllKronis();
    const primaryCount = data.filter(o => !o.isVariant).length;

    const profileText = `DARSI APOTEKER - PROFIL

IDENTITAS:
Nama: DARSI Apoteker
Institusi: RSI Surabaya (Rumah Sakit Islam Surabaya)
Database: Daftar Restriksi Obat Kronis BPJS di RSI Surabaya
Jumlah Obat: ${primaryCount} macam (No. 1-${primaryCount})
Bahasa: Bahasa Indonesia

KEMAMPUAN (BISA):
- Mencari obat berdasarkan nama
- Menampilkan seluruh daftar obat kronis
- Memberikan informasi: nama obat, restriksi penggunaan, peresepan maksimal, SMF
- Merespons dalam Bahasa Indonesia
- Menangani variasi ejaan dalam pencarian

KETERBATASAN (TIDAK BISA):
- TIDAK memberikan rekomendasi medis atau saran kesehatan
- TIDAK mendiagnosa penyakit
- TIDAK memberikan saran dosis atau cara mengkonsumsi
- TIDAK memberikan informasi tentang obat di luar database RSI Surabaya
- TIDAK memberikan informasi tentang topik yang tidak berhubungan dengan obat

CATATAN:
Data dalam database ini adalah daftar restriksi obat kronis yang berlaku di RSI Surabaya untuk program BPJS dan asuransi kesehatan. Untuk pertanyaan medis, harap berkonsultasi dengan dokter atau apoteker profesional.`;

    return profileText;
  },
});

// ─── TOOL 2: LIST ALL MEDICINES ─────────────────────────────
/**
 * Returns complete list of all medicines in database.
 * 
 * Used when user asks: "daftar", "tampilkan", "list", "semua"
 * 
 * Output format:
 * - Clear header with total count
 * - Numbered list of all medicine names
 * - Clean, no fancy formatting
 */
export const listAllMedicines = createTool({
  name: "list-all-medicines",
  description:
    "Show complete list of ALL medicines in RSI Surabaya chronic medicine database. Output MUST be displayed exactly as-is.",
  parameters: z.object({}),
  execute: async (): Promise<string> => {
    try {
      const data = await loadAllKronis();

      // Group by medicine number, showing variants as sub-items
      const primaryMeds = data.filter(o => !o.isVariant);
      const variants = data.filter(o => o.isVariant);

      const lines: string[] = [];
      lines.push(`DAFTAR LENGKAP OBAT KRONIS RSI SURABAYA (${primaryMeds.length} obat):`);
      lines.push("───────────────────────────────────────");

      for (const med of primaryMeds) {
        lines.push(`${med.no}. ${med.nama}`);
        
        // Find variants for this medicine number
        const medVariants = variants.filter(v => v.no === med.no);
        for (const v of medVariants) {
          lines.push(`   ↳ ${v.nama}${v.peresepan !== med.peresepan && v.peresepan !== "-" ? ` (${v.peresepan})` : ""}`);
        }
      }

      lines.push("───────────────────────────────────────");
      lines.push(`Total: ${primaryMeds.length} obat kronis`);

      return lines.join("\n");
    } catch (error) {
      // Silent error - return fallback message
      return "Terjadi kesalahan saat menampilkan daftar obat.";
    }
  },
});

// ─── TOOL 3: RECOMMEND MEDICINES FOR CONDITION ──────────────
/**
 * Recommend medicines based on condition/disease keyword.
 * Searches in the RESTRIKSI field for relevant medicines.
 * 
 * Used when user asks: "obat untuk diabetes", "ada obat asma", "obat hipertensi"
 * 
 * Returns: Foods from database that mention the condition in restriksi field
 * With disclaimer: "Sesuaikan dengan resep dokter"
 */
export const recommendMedicines = createTool({
  name: "recommend-medicines",
  description:
    "Recommend medicines for a specific condition based on database description. User must consult doctor for final decision.",
  parameters: z.object({
    condition: z
      .string()
      .describe("Condition or disease (e.g., diabetes, hipertensi, asma)"),
  }),
  execute: async ({ condition }): Promise<string> => {
    try {
      const data = await loadAllKronis();
      const q = (condition ?? "").trim().toLowerCase();

      if (!q || q.length < 2) {
        return "Mohon masukkan nama kondisi/penyakit yang lebih spesifik.";
      }

      // Search in RESTRIKSI field for condition-related medicines
      const results = data.filter(obat => {
        const restriksiLower = obat.restriksi.toLowerCase();
        return restriksiLower.includes(q) || restriksiLower.includes(norm(q));
      });

      // Explicit empty check BEFORE formatting output
      if (!results || results.length === 0) {
        return `Tidak ada obat di database untuk kondisi "${condition}". Silakan konsultasi dengan dokter untuk rekomendasi yang tepat.`;
      }

      // Format output with disclaimer - only if results exist
      const lines: string[] = [];
      lines.push(`Obat-obatan untuk "${condition}" (ditemukan ${results.length} obat):`);
      lines.push("");
      lines.push("⚠️ CATATAN PENTING: Daftar ini hanya referensi database. Keputusan penggunaan obat harus sesuai resep dokter/apoteker profesional.");
      lines.push("");

      for (let i = 0; i < Math.min(10, results.length); i++) {
        const o = results[i]!;
        lines.push(`${i + 1}. ${o.nama}`);

        if (o.restriksi && o.restriksi !== "-") {
          lines.push(`   Restriksi: ${o.restriksi}`);
        }

        if (o.peresepan && o.peresepan !== "-") {
          lines.push(`   Peresepan: ${o.peresepan}`);
        }

        if (o.smf && o.smf !== "-") {
          lines.push(`   SMF: ${o.smf}`);
        }

        lines.push("");
      }

      lines.push("Konsultasikan dengan dokter atau apoteker untuk penentuan dosis dan cara penggunaan yang tepat.");

      return lines.join("\n");
    } catch (error) {
      // Silent error - return fallback message
      return "Terjadi kesalahan saat mencari rekomendasi obat.";
    }
  },
});

export { loadAllKronis, searchMedicinesHelper };
