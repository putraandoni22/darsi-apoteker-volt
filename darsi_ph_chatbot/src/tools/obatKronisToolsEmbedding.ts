/**
 * Enhanced medicines tools using LanceDB vector embeddings.
 * Falls back to CSV-based search if LanceDB is not initialized.
 */

import { createTool } from "@voltagent/core";
import { z } from "zod";
import { LanceDBRetriever } from "../embedding/lanceDBRetriever.js";
import * as path from "path";

// Import original tools for fallback
import {
  searchMedicinesHelper as originalSearch,
  loadAllKronis,
  type KronisObat,
} from "./obatKronisTools.js";

function extractString(val: unknown): string {
  if (typeof val === "string") return val;
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (typeof obj.value === "string") return obj.value;
    if (typeof obj.query === "string") return obj.query;
    if (typeof obj.condition === "string") return obj.condition;
    if (obj.description && !obj.value && !obj.query && !obj.condition) return "";
  }
  return String(val ?? "");
}

function normalizeMedicineName(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type MedicineNoLookup = {
  byName: Map<string, string>;
  entries: Array<{ normalizedName: string; no: string }>;
};

function buildMedicineNoLookup(data: KronisObat[]): MedicineNoLookup {
  const byName = new Map<string, string>();
  const entries: Array<{ normalizedName: string; no: string }> = [];

  for (const item of data) {
    const normalizedName = normalizeMedicineName(item.nama);
    const number = String(item.no || "").trim();

    if (!normalizedName || !number) {
      continue;
    }

    if (!byName.has(normalizedName)) {
      byName.set(normalizedName, number);
    }

    entries.push({ normalizedName, no: number });
  }

  return { byName, entries };
}

function resolveMedicineNumber(name: string, lookup: MedicineNoLookup): string {
  const normalizedName = normalizeMedicineName(name);
  if (!normalizedName) {
    return "-";
  }

  const exact = lookup.byName.get(normalizedName);
  if (exact) {
    return exact;
  }

  const fuzzy = lookup.entries.find(
    (entry) =>
      entry.normalizedName.includes(normalizedName) ||
      normalizedName.includes(entry.normalizedName)
  );

  return fuzzy?.no || "-";
}

const MED_QUERY_STOPWORDS = new Set([
  "tolong",
  "mohon",
  "saya",
  "aku",
  "cari",
  "carikan",
  "cek",
  "lihat",
  "tampilkan",
  "berikan",
  "informasi",
  "info",
  "detail",
  "rekomendasi",
  "obat",
  "nomor",
  "kode",
  "resep",
  "peresepan",
  "maksimal",
  "aturan",
  "pakai",
  "dosis",
  "untuk",
  "tentang",
  "yang",
  "dengan",
  "dan",
  "atau",
  "di",
  "ke",
  "dari",
  "bpjs",
  "fornas",
  "rsi",
]);

const MED_CATALOG_GENERIC_TOKENS = new Set([
  "informasi",
  "info",
  "data",
  "detail",
  "obat",
  "kronis",
  "rsi",
  "darsi",
  "apoteker",
  "program",
  "database",
  "daftar",
  "list",
  "katalog",
  "lengkap",
  "keseluruhan",
  "seluruh",
  "semua",
  "full",
]);

function parseRequestedPage(rawQuery: string): number {
  const normalized = String(rawQuery || "").toLowerCase();
  const match = normalized.match(/(?:hal(?:aman)?|page)\s*(\d{1,4})/i);
  const page = Number(match?.[1] || "1");
  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.floor(page);
}

function extractMedicineLookupQuery(rawQuery: string): string {
  const trimmed = String(rawQuery || "").trim();
  if (!trimmed) {
    return "";
  }

  // Respect explicit phrase if user wraps medicine in quotes.
  const quoted = trimmed.match(/["']([^"']+)["']/)?.[1]?.trim();
  if (quoted) {
    return quoted;
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
    .filter((token) => !MED_QUERY_STOPWORDS.has(token));

  if (tokens.length === 0) {
    return trimmed;
  }

  return tokens.slice(0, 6).join(" ").trim();
}

function isBroadMedicineCatalogIntent(rawQuery: string): boolean {
  const normalized = String(rawQuery || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized || !/\bobat\b/.test(normalized)) {
    return false;
  }

  if (
    /\b(semua|seluruh|keseluruhan|daftar|list|katalog|lengkap|full)\b.*\b(obat|database|data)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  if (
    /\b(obat|database|data)\b.*\b(semua|seluruh|keseluruhan|daftar|list|katalog|lengkap|full)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  if (/^(informasi|data|detail)\s+obat(?:\s+(rsi|darsi|kronis))?$/.test(normalized)) {
    return true;
  }

  const lookupQuery = extractMedicineLookupQuery(rawQuery)
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

  return specificTokens.every((token) => MED_CATALOG_GENERIC_TOKENS.has(token));
}

function cleanKronisField(value: string, maxLength = 180): string {
  const normalized = String(value || "")
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

type SediaanRule = {
  pattern: RegExp;
  label: string;
};

const SEDIAAN_RULES: SediaanRule[] = [
  { pattern: /\btab(?:let)?\b/i, label: "Tablet" },
  { pattern: /\bkap(?:sul)?\b|\bcaps?(?:ule)?\b/i, label: "Kapsul" },
  { pattern: /\bsirup\b|\bsyrup\b|\bsyr\b/i, label: "Sirup" },
  { pattern: /\bsuspensi\b|\bsuspen\b/i, label: "Suspensi" },
  { pattern: /\b(drop|tetes)\b/i, label: "Tetes" },
  { pattern: /\b(inj|injeksi|injection)\b/i, label: "Injeksi" },
  { pattern: /\b(iv|infus)\b/i, label: "Infus" },
  { pattern: /\b(salep|ointment)\b/i, label: "Salep" },
  { pattern: /\b(krim|cream)\b/i, label: "Krim" },
  { pattern: /\bgel\b/i, label: "Gel" },
  { pattern: /\b(suppositoria|supp)\b/i, label: "Supositoria" },
  { pattern: /\bpatch\b/i, label: "Patch" },
  { pattern: /\b(inhaler|inhalasi)\b/i, label: "Inhaler" },
  { pattern: /\bspray\b/i, label: "Spray" },
  { pattern: /\b(serbuk|powder|pulv(?:eres)?)\b/i, label: "Serbuk" },
];

function inferSediaanFromName(name: string): string {
  const normalized = String(name || "").toLowerCase();
  if (!normalized) {
    return "informasi belum tersedia";
  }

  for (const rule of SEDIAAN_RULES) {
    if (rule.pattern.test(normalized)) {
      return rule.label;
    }
  }

  return "informasi belum tersedia";
}

function extractDoseFromName(name: string): string {
  const raw = String(name || "");
  if (!raw) {
    return "informasi belum tersedia";
  }

  const match = raw.match(
    /(\d+(?:[.,]\d+)?\s*(?:mg|mcg|ug|g|ml|iu|meq|mmol|%)(?:\s*\/\s*\d+(?:[.,]\d+)?\s*(?:ml|l))?)/i,
  );
  if (!match) {
    return "informasi belum tersedia";
  }

  const value = match[1];
  if (!value) {
    return "informasi belum tersedia";
  }

  return value.replace(/\s+/g, " ").replace(/,/g, ".").trim();
}

function sanitizeTableCell(value: string): string {
  return String(value || "informasi belum tersedia").replace(/\|/g, "∣").trim();
}

function formatFullKronisCatalog(data: KronisObat[], rawQuery: string): string {
  if (!Array.isArray(data) || data.length === 0) {
    return "Database obat kronis RSI belum tersedia.";
  }

  const pageSize = 25;
  const requestedPage = parseRequestedPage(rawQuery);
  const primaryMeds = data.filter((item) => !item.isVariant);
  const totalPages = Math.max(1, Math.ceil(primaryMeds.length / pageSize));
  const currentPage = Math.min(Math.max(requestedPage, 1), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const pageItems = primaryMeds.slice(startIndex, startIndex + pageSize);

  const variantsByNo = new Map<string, KronisObat[]>();
  for (const item of data) {
    if (!item.isVariant) continue;
    const key = String(item.no || "").trim();
    if (!key) continue;
    const existing = variantsByNo.get(key) || [];
    existing.push(item);
    variantsByNo.set(key, existing);
  }

  const lines: string[] = [];
  lines.push("DAFTAR LENGKAP OBAT KRONIS RSI SURABAYA");
  lines.push(`Total obat utama: ${primaryMeds.length}`);
  lines.push(`Halaman: ${currentPage}/${totalPages} (menampilkan ${pageItems.length} obat)`);
  lines.push("");

  lines.push("| No | Nama Obat | Bentuk Sediaan | Dosis / Kekuatan | Sumber Data |");
  lines.push("|---|---|---|---|---|");

  for (let i = 0; i < pageItems.length; i++) {
    const item = pageItems[i];
    if (!item) continue;

    const rowNo = String(item.no || startIndex + i + 1);
    const nama = sanitizeTableCell(item.nama);
    const bentuk = sanitizeTableCell(inferSediaanFromName(item.nama));
    const dosis = sanitizeTableCell(extractDoseFromName(item.nama));
    lines.push(`| ${rowNo} | ${nama} | ${bentuk} | ${dosis} | Obat Kronis RSI |`);

    const variants = (variantsByNo.get(item.no) || [])
      .map((variant) => variant.nama)
      .filter((variantName) => normalizeMedicineName(variantName) !== normalizeMedicineName(item.nama));

    for (const variantName of variants) {
      const variant = sanitizeTableCell(variantName);
      const variantBentuk = sanitizeTableCell(inferSediaanFromName(variantName));
      const variantDosis = sanitizeTableCell(extractDoseFromName(variantName));
      lines.push(`| ${rowNo} | -> ${variant} | ${variantBentuk} | ${variantDosis} | Obat Kronis RSI |`);
    }
  }

  lines.push("");
  if (currentPage < totalPages) {
    lines.push(
      `Untuk lanjut, tulis: "tampilkan seluruh data obat halaman ${currentPage + 1}".`,
    );
  } else {
    lines.push("Semua halaman data obat kronis RSI sudah ditampilkan.");
  }

  return lines.join("\n");
}

function hasAnyTokenMatch(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) {
    return true;
  }

  const normalizedText = normalizeMedicineName(text);
  return tokens.some((token) => normalizedText.includes(token.toLowerCase()));
}

// ─── MARKDOWN TABLE FORMATTER ──────────────────────────────
/**
 * Formats medicine results as a Markdown table.
 * Table is pre-formatted and MUST NOT be modified by LLM.
 */
function formatMedicineAsMarkdownTable(results: any[]): string {
  if (!results || results.length === 0) {
    return "Obat tidak ditemukan dalam database.";
  }

  const lines: string[] = [];
  
  // Header
  lines.push("| No | Nama Obat | Bentuk Sediaan | Dosis / Kekuatan | Sumber Data |");
  lines.push("|---|---|---|---|---|");
  
  // Rows
  for (let i = 0; i < Math.min(10, results.length); i++) {
    const o = results[i];
    const no = o.no && o.no !== "-" ? o.no : String(i + 1);
    const nama = sanitizeTableCell(o.nama || "-");
    const bentuk = sanitizeTableCell(inferSediaanFromName(o.nama || ""));
    const dosis = sanitizeTableCell(extractDoseFromName(o.nama || ""));
    const sumber = "Obat Kronis RSI";
    
    lines.push(`| ${no} | ${nama} | ${bentuk} | ${dosis} | ${sumber} |`);
  }
  
  // Footer
  lines.push("");
  lines.push(`**Total: ${results.length} hasil** | Sumber: Database RSI Surabaya`);
  
  return lines.join("\n");
}

// Initialize retriever
const retriever = new LanceDBRetriever(
  process.env.LANCEDB_URI || path.resolve(".voltagent/lancedb")
);

// Check if LanceDB is initialized (check on every tool call, not module load)
async function checkLanceDB(): Promise<boolean> {
  try {
    const results = await retriever.getAllMedicines(1);
    return results.length > 0;
  } catch (error) {
    // LanceDB not available - will fallback to CSV
    return false;
  }
}

/**
 * Enhanced searchMedicines tool that uses vector embeddings
 * Falls back to CSV search if LanceDB not available
 * CRITICAL: Returns pre-formatted Markdown table. DO NOT convert to list.
 */
export const searchMedicinesEmbedding = createTool({
  name: "search-medicines",
  description:
    "Search medicines from RSI Surabaya chronic medicine database. RETURNS PRE-FORMATTED MARKDOWN TABLE with columns: No | Nama Obat | Bentuk Sediaan | Dosis/Kekuatan | Sumber Data. YOU MUST pass this table directly to the user WITHOUT converting to list format. Supports fuzzy matching and semantic search.",
  parameters: z.object({
    query: z.preprocess(
      (val) => extractString(val),
      z.string()
    ).describe("Medicine name to search (e.g., Vitamin B Komplek, Paracetamol)"),
  }),
  execute: async ({ query }): Promise<string> => {
    try {
      const q = (query ?? "").trim();

      if (!q || q.length < 2) {
        return "Mohon masukkan nama obat yang lebih spesifik (minimal 2 karakter).";
      }

      const kronisData = await loadAllKronis();
      if (isBroadMedicineCatalogIntent(q)) {
        return formatFullKronisCatalog(kronisData, q);
      }

      const lookupQuery = extractMedicineLookupQuery(q);
      const lookupTokens = lookupQuery
        .toLowerCase()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3);
      const medicineNoLookup = buildMedicineNoLookup(kronisData);

      let results: any[] = [];
      let source = "CSV";

      // Prioritize direct CSV match first for medicine-name style requests.
      if (lookupQuery.length >= 2) {
        const strictCsvResults = originalSearch(kronisData, lookupQuery);
        if (strictCsvResults.length > 0) {
          const maxStrictResults = lookupQuery.length > 12 ? 4 : 3;
          results = strictCsvResults.slice(0, maxStrictResults).map((o: any) => ({
            no: o.no,
            nama: o.nama,
            restriksi: o.restriksi,
            peresepan: o.peresepan,
            smf: o.smf,
          }));
          source = "CSV Exact";
        }
      }

      // Check LanceDB availability at execution time
      const lancedbAvailable = await checkLanceDB();

      if (lancedbAvailable && results.length === 0) {
        try {
          // Try semantic search first
          source = "Vector Embedding";
          const vectorResults = await retriever.search(lookupQuery || q, 5);

          // Filter by HIGH score threshold (0.65 = 65% similarity)
          const MIN_SCORE_THRESHOLD = 0.55;
          const highQualityResults = vectorResults.filter(
            (r: any) => r.score >= MIN_SCORE_THRESHOLD
          );

          const tokenMatchedResults = highQualityResults.filter((result: any) =>
            hasAnyTokenMatch(result.nama, lookupTokens)
          );

          const selectedVectorResults =
            tokenMatchedResults.length > 0 ? tokenMatchedResults : highQualityResults;

          results = selectedVectorResults.map((result: any) => ({
            no: resolveMedicineNumber(result.nama, medicineNoLookup),
            nama: result.nama,
            restriksi: result.restriksi,
            peresepan: result.peresepan,
            smf: result.smf,
            score: result.score,
          }));

          // If no good semantic results, try name search
          if (results.length === 0) {
            const nameResults = await retriever.searchByName(lookupQuery || q, 5);
            if (nameResults.length > 0) {
              source = "Name Match";
              results = nameResults.map((result: any) => ({
                no: resolveMedicineNumber(result.nama, medicineNoLookup),
                nama: result.nama,
                restriksi: result.restriksi,
                peresepan: result.peresepan,
                smf: result.smf,
                score: result.score,
              }));
            }
          }
        } catch (vecError) {
          // Vector search failed - silently fallback to CSV
          // Continue to CSV fallback below
        }
      }

      // Fallback to CSV search
      if (results.length === 0) {
        const data = kronisData;

        // Use helper function for CSV-based search
        let csvResults = originalSearch(data, lookupQuery || q);

        // Relaxed token fallback: helps when user instruction is descriptive, not exact medicine name.
        if (csvResults.length === 0) {
          const keywords = (lookupQuery || q)
            .toLowerCase()
            .split(/\s+/)
            .map((token) => token.trim())
            .filter((token) => token.length >= 3);

          if (keywords.length > 0) {
            const relaxedMatches = data
              .map((obat: any) => {
                const name = String(obat.nama || "").toLowerCase();
                let score = 0;

                if (name.includes((lookupQuery || q).toLowerCase())) {
                  score += 5;
                }

                for (const keyword of keywords) {
                  if (name.includes(keyword)) {
                    score += keyword.length >= 5 ? 2 : 1;
                  }
                }

                return { obat, score };
              })
              .filter((item: any) => item.score > 0)
              .sort((a: any, b: any) => b.score - a.score)
              .map((item: any) => item.obat);

            if (relaxedMatches.length > 0) {
              csvResults = relaxedMatches;
            }
          }
        }

        if (csvResults.length === 0) {
          return `Obat "${q}" tidak ditemukan di database RSI Surabaya.`;
        }

        // CSV fallback: provide a few ranked candidates so user instructions don't require exact names.
        const maxCsvResults = q.length > 12 ? 4 : q.length > 5 ? 3 : 2;
        const acceptableResults = csvResults.slice(0, maxCsvResults);

        results = acceptableResults.map((o: any) => ({
          no: o.no,
          nama: o.nama,
          restriksi: o.restriksi,
          peresepan: o.peresepan,
          smf: o.smf,
        }));

        source = "CSV";
      }

      // Check if any results found
      if (results.length === 0) {
        return `Obat "${q}" tidak ditemukan di database RSI Surabaya.`;
      }

      // Return pre-formatted Markdown table (DO NOT MODIFY)
      return formatMedicineAsMarkdownTable(results);
    } catch (error) {
      // Silent error - return fallback message
      return "Terjadi kesalahan saat mencari obat. Silakan coba lagi.";
    }
  },
});

/**
 * Enhanced recommendMedicines tool using semantic search
 * Falls back to CSV-based condition search
 * CRITICAL: Returns pre-formatted Markdown table. DO NOT convert to list.
 */
export const recommendMedicinesEmbedding = createTool({
  name: "recommend-medicines",
  description:
    "Recommend medicines for a specific condition from RSI Surabaya database. RETURNS PRE-FORMATTED MARKDOWN TABLE with columns: No | Nama Obat | Bentuk Sediaan | Dosis/Kekuatan | Sumber Data. YOU MUST pass this table directly to the user WITHOUT converting to list format. User must consult doctor for final decision.",
  parameters: z.object({
    condition: z.preprocess(
      (val) => extractString(val),
      z.string()
    ).describe("Condition or disease (e.g., diabetes, hipertensi, asma)"),
  }),
  execute: async ({ condition }): Promise<string> => {
    try {
      const q = (condition ?? "").trim();

      if (!q || q.length < 2) {
        return "Mohon masukkan nama kondisi/penyakit yang lebih spesifik.";
      }

      const kronisData = await loadAllKronis();
      const medicineNoLookup = buildMedicineNoLookup(kronisData);

      // ANTI-HALLUCINATION: Reject conditions NOT in RSI database
      const OUT_OF_SCOPE = ["kanker", "tumor", "epilepsi", "schizophrenia", "bipolar", "parkinson", "alzheimer", "autism", "hiv", "aids", "tuberkulosis", "tb", "hepatitis", "covid"];
      const qLower = q.toLowerCase();
      if (OUT_OF_SCOPE.some(condition => qLower.includes(condition))) {
        return `Kondisi "${q}" tidak tersedia di database obat kronis RSI Surabaya. Silakan konsultasi langsung ke rumah sakit untuk informasi lengkap.`;
      }

      let results: any[] = [];
      let source = "CSV";
      const conditionKeywords = qLower
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3);

      // Check LanceDB availability at execution time
      const lancedbAvailable = await checkLanceDB();

      if (lancedbAvailable) {
        try {
          // Use semantic search for condition
          source = "Vector Embedding";
          const vectorResults = await retriever.search(
            `obat untuk ${q}`,
            10
          );

          // Accept condition results with moderate confidence to reduce exact-match dependency.
          const MIN_CONDITION_SCORE = 0.55;
          const highQualityResults = vectorResults.filter(
            (r: any) => r.score >= MIN_CONDITION_SCORE
          );

          const keywordValidated = highQualityResults.filter((result: any) => {
            const restriksi = String(result.restriksi || "").toLowerCase();
            if (conditionKeywords.length === 0) {
              return true;
            }

            return conditionKeywords.some((keyword) => restriksi.includes(keyword));
          });

          if (keywordValidated.length > 0) {
            results = keywordValidated.map((result: any) => ({
              no: resolveMedicineNumber(result.nama, medicineNoLookup),
              nama: result.nama,
              restriksi: result.restriksi,
              peresepan: result.peresepan,
              smf: result.smf,
              score: result.score,
            }));
          }
        } catch (vecError) {
          // Vector search failed - silently fallback to CSV
          // Continue to CSV fallback below
        }
      }

      // Fallback: CSV-based condition search
      if (results.length === 0) {
        const data = kronisData;
        const qLower = q.toLowerCase();
        
        // Extract keywords: split by space and filter empty
        const keywords = qLower
          .split(/\s+/)
          .filter((kw: string) => kw.length > 2);

        // CSV filter: requires at least 2 keywords to match (prevent false positives)
        // If only 1 keyword, require exact longer match
        const minKeywordMatch = keywords.length >= 3 ? 2 : 1;
        const csvResults = data
          .map((obat: any) => {
            const restriksiLower = String(obat.restriksi || "").toLowerCase();
            const matchCount = keywords.filter((kw: string) => restriksiLower.includes(kw)).length;
            return { obat, matchCount };
          })
          .filter((item: any) => item.matchCount >= minKeywordMatch)
          .sort((a: any, b: any) => b.matchCount - a.matchCount)
          .map((item: any) => item.obat);

        if (csvResults.length === 0) {
          return `Tidak ada obat di database untuk kondisi "${condition}". Silakan konsultasi dengan dokter untuk rekomendasi yang tepat.`;
        }

        // Limit CSV results with balanced recall so non-exact condition wording is still useful.
        const acceptableResults = csvResults.slice(0, 5);

        results = acceptableResults.map((o: any) => ({
          no: o.no,
          nama: o.nama,
          restriksi: o.restriksi,
          peresepan: o.peresepan,
          smf: o.smf,
        }));

        source = "CSV";
      }

      // Return pre-formatted Markdown table (DO NOT MODIFY)
      if (results.length === 0) {
        return `Tidak ada obat di database untuk kondisi "${condition}".`;
      }
      
      return formatMedicineAsMarkdownTable(results);
    } catch (error) {
      // Silent error - return fallback message
      return "Terjadi kesalahan saat mencari rekomendasi obat.";
    }
  },
});

// Export check function for initialization
export { checkLanceDB };
