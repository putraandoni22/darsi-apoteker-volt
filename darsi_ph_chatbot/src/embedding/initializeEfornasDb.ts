import * as fs from "fs";
import * as path from "path";
import { connect } from "@lancedb/lancedb";

const LANCEDB_URI = process.env.LANCEDB_URI || path.resolve(".voltagent/lancedb");
const TABLE_NAME = "efornas-knowledge-base";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const EMBEDDING_MODEL = "snowflake-arctic-embed";

// ─── OLLAMA EMBEDDING FUNCTION ───────────────────────────────
async function generateEmbeddingFromOllama(text: string): Promise<number[]> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as any;
  if (!data.embeddings?.[0]) {
    throw new Error("Invalid embedding response from Ollama");
  }
  return data.embeddings[0];
}

// ─── TYPES ───────────────────────────────────────────────────
export interface EfornasRecord {
  id: string;
  id_obat: number;
  nama_obat: string;
  nama_obat_internasional: string;
  kelas_terapi: string;
  sub_kelas_terapi: string;
  sub_sub_kelas_terapi: string;
  sub_sub_sub_kelas_terapi: string;
  sediaan: string;
  kekuatan: string;
  satuan: string;
  fpktp: string;
  fpktl: string;
  pp: string;
  prb: string;
  oen: string;
  program: string;
  kanker: string;
  komposisi: string;
  restriksi_kelas_terapi: string;
  restriksi_sub_kelas_terapi: string;
  restriksi_sub_sub_kelas_terapi: string;
  restriksi_sub_sub_sub_kelas_terapi: string;
  restriksi_obat: string;
  restriksi_sediaan: string;
  peresepan_maksimal: string;
  content: string;
  vector: number[];
}

// ─── CSV PARSER ──────────────────────────────────────────────
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
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

  if (accumulator) joined.push(accumulator);
  return joined;
}

// ─── LOAD CSV DATA ──────────────────────────────────────────
function loadEfornasCSV(): EfornasRecord[] {
  const csvPath = path.join(process.cwd(), "data", "efornas_obat_lengkap.csv");

  if (!fs.existsSync(csvPath)) {
    throw new Error(
      `CSV not found: ${csvPath}\nRun 'python3 scripts/scrape_efornas.py' first.`
    );
  }

  const text = fs.readFileSync(csvPath, "utf-8");
  const lines = joinMultiLineQuotedFields(text);
  const records: EfornasRecord[] = [];

  // First line is header
  const header = parseCSVLine(lines[0] || "");
  const colIndex: Record<string, number> = {};
  header.forEach((h, i) => {
    if (h) colIndex[h] = i;
  });

  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] || "").trim();
    if (!line) continue;

    const cols = parseCSVLine(line);
    const get = (col: string) => cols[colIndex[col] ?? 0] || "";

    const nama = get("nama_obat");
    if (!nama) continue;

    // Build rich content string for embedding
    const parts: string[] = [
      `Nama: ${nama}`,
      get("nama_obat_internasional") && `Nama Internasional: ${get("nama_obat_internasional")}`,
      get("kelas_terapi") && `Kelas Terapi: ${get("kelas_terapi")}`,
      get("sub_kelas_terapi") && `Sub Kelas: ${get("sub_kelas_terapi")}`,
      get("sub_sub_kelas_terapi") && `Sub Sub Kelas: ${get("sub_sub_kelas_terapi")}`,
      get("sub_sub_sub_kelas_terapi") && `Kategori: ${get("sub_sub_sub_kelas_terapi")}`,
      get("sediaan") && `Sediaan: ${get("sediaan")} ${get("kekuatan")} ${get("satuan")}`,
      get("komposisi") && `Komposisi: ${get("komposisi")}`,
      get("restriksi_obat") && `Restriksi: ${get("restriksi_obat")}`,
      get("peresepan_maksimal") && `Peresepan Maksimal: ${get("peresepan_maksimal")}`,
    ].filter(Boolean) as string[];

    // Level fasilitas kesehatan
    const levels: string[] = [];
    if (get("fpktp") === "Ya") levels.push("FKTP");
    if (get("fpktl") === "Ya") levels.push("FKTL");
    if (get("prb") === "Ya") levels.push("PRB");
    if (get("oen") === "Ya") levels.push("OEN");
    if (get("program") === "Ya") levels.push("Program Kemenkes");
    if (levels.length > 0) parts.push(`Tersedia di: ${levels.join(", ")}`);

    const content = parts.join(". ");

    records.push({
      id: `efornas_${i}`,
      id_obat: parseInt(get("id_obat")) || 0,
      nama_obat: nama,
      nama_obat_internasional: get("nama_obat_internasional"),
      kelas_terapi: get("kelas_terapi"),
      sub_kelas_terapi: get("sub_kelas_terapi"),
      sub_sub_kelas_terapi: get("sub_sub_kelas_terapi"),
      sub_sub_sub_kelas_terapi: get("sub_sub_sub_kelas_terapi"),
      sediaan: get("sediaan"),
      kekuatan: get("kekuatan"),
      satuan: get("satuan"),
      fpktp: get("fpktp"),
      fpktl: get("fpktl"),
      pp: get("pp"),
      prb: get("prb"),
      oen: get("oen"),
      program: get("program"),
      kanker: get("kanker"),
      komposisi: get("komposisi"),
      restriksi_kelas_terapi: get("restriksi_kelas_terapi"),
      restriksi_sub_kelas_terapi: get("restriksi_sub_kelas_terapi"),
      restriksi_sub_sub_kelas_terapi: get("restriksi_sub_sub_kelas_terapi"),
      restriksi_sub_sub_sub_kelas_terapi: get("restriksi_sub_sub_sub_kelas_terapi"),
      restriksi_obat: get("restriksi_obat"),
      restriksi_sediaan: get("restriksi_sediaan"),
      peresepan_maksimal: get("peresepan_maksimal"),
      content,
      vector: [],
    });
  }

  return records;
}

// ─── TRUNCATE FOR EMBEDDING ──────────────────────────────────
// snowflake-arctic-embed has ~512 token context window
// Truncate embedding text to ~480 chars to stay safe, but keep full content in DB
const MAX_EMBED_CHARS = 480;

function truncateForEmbedding(content: string): string {
  if (content.length <= MAX_EMBED_CHARS) return content;
  return content.slice(0, MAX_EMBED_CHARS);
}

// ─── GENERATE EMBEDDINGS ─────────────────────────────────────
async function generateEmbeddings(records: EfornasRecord[]): Promise<EfornasRecord[]> {
  console.log(`📚 Generating embeddings for ${records.length} e-Fornas records...`);
  console.log(`   Model: ${EMBEDDING_MODEL}`);
  console.log(`   Endpoint: ${OLLAMA_BASE_URL}`);

  const result: EfornasRecord[] = [];
  let truncated = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;

    try {
      const embedText = truncateForEmbedding(record.content);
      if (embedText.length < record.content.length) truncated++;
      const vector = await generateEmbeddingFromOllama(embedText);
      result.push({ ...record, vector });

      if ((i + 1) % 50 === 0 || i === records.length - 1) {
        console.log(`  ✓ Embedded ${i + 1}/${records.length} records`);
      }
    } catch (error) {
      console.error(`Error embedding ${record.nama_obat}:`, error);
      throw error;
    }
  }

  if (truncated > 0) {
    console.log(`⚠️ ${truncated} records truncated to ${MAX_EMBED_CHARS} chars for embedding`);
  }
  console.log(`✅ All ${result.length} records embedded`);
  return result;
}

// ─── INITIALIZE LANCEDB ──────────────────────────────────────
async function initializeDatabase(): Promise<void> {
  try {
    console.log("🚀 Initializing e-Fornas LanceDB...\n");

    // Load CSV
    console.log("📖 Loading e-Fornas CSV...");
    const records = loadEfornasCSV();
    const uniqueDrugs = new Set(records.map((r) => r.nama_obat));
    console.log(`✅ Loaded ${records.length} records (${uniqueDrugs.size} obat unik)\n`);

    // Generate embeddings
    const recordsWithEmbeddings = await generateEmbeddings(records);

    // Connect to LanceDB
    if (!LANCEDB_URI.startsWith("lancedb+")) {
      const dir = path.dirname(LANCEDB_URI);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    console.log(`\n📦 Connecting to LanceDB at ${LANCEDB_URI}...`);
    const db = await connect(LANCEDB_URI);

    // Drop existing table if exists
    const tableNames = await db.tableNames();
    if (tableNames.includes(TABLE_NAME)) {
      console.log(`🔄 Table "${TABLE_NAME}" exists, overwriting...`);
      await db.dropTable(TABLE_NAME);
    }

    // Create table
    console.log(`📋 Creating table "${TABLE_NAME}"...`);
    const dataForTable = recordsWithEmbeddings.map((r) => ({
      id: r.id,
      id_obat: r.id_obat,
      nama_obat: r.nama_obat,
      nama_obat_internasional: r.nama_obat_internasional,
      kelas_terapi: r.kelas_terapi,
      sub_kelas_terapi: r.sub_kelas_terapi,
      sub_sub_kelas_terapi: r.sub_sub_kelas_terapi,
      sub_sub_sub_kelas_terapi: r.sub_sub_sub_kelas_terapi,
      sediaan: r.sediaan,
      kekuatan: r.kekuatan,
      satuan: r.satuan,
      fpktp: r.fpktp,
      fpktl: r.fpktl,
      pp: r.pp,
      prb: r.prb,
      oen: r.oen,
      program: r.program,
      kanker: r.kanker,
      komposisi: r.komposisi,
      restriksi_kelas_terapi: r.restriksi_kelas_terapi,
      restriksi_sub_kelas_terapi: r.restriksi_sub_kelas_terapi,
      restriksi_sub_sub_kelas_terapi: r.restriksi_sub_sub_kelas_terapi,
      restriksi_sub_sub_sub_kelas_terapi: r.restriksi_sub_sub_sub_kelas_terapi,
      restriksi_obat: r.restriksi_obat,
      restriksi_sediaan: r.restriksi_sediaan,
      peresepan_maksimal: r.peresepan_maksimal,
      content: r.content,
      vector: r.vector,
    }));

    await db.createTable(TABLE_NAME, dataForTable);
    console.log(`✅ Table "${TABLE_NAME}" created with ${recordsWithEmbeddings.length} records`);

    // Create vector index
    try {
      const table = await db.openTable(TABLE_NAME);
      await table.createIndex("vector");
      console.log("📊 Vector index created");
    } catch {
      console.warn("⚠️ Vector index not created (will still work without it)");
    }

    console.log("\n" + "=".repeat(50));
    console.log("✅ e-Fornas database initialized!");
    console.log(`   📊 ${recordsWithEmbeddings.length} records, ${uniqueDrugs.size} obat unik`);
    console.log(`   📁 DB: ${LANCEDB_URI}`);
    console.log(`   📋 Table: ${TABLE_NAME}`);
    console.log("=".repeat(50));
  } catch (error) {
    console.error("❌ Failed to initialize e-Fornas database:", error);
    process.exit(1);
  }
}

initializeDatabase();
