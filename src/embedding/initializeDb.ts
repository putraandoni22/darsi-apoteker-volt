import * as fs from "fs";
import * as path from "path";
import { connect } from "@lancedb/lancedb";

const LANCEDB_URI = process.env.LANCEDB_URI || path.resolve(".voltagent/lancedb");
const TABLE_NAME = "medicines-knowledge-base";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const EMBEDDING_MODEL = "snowflake-arctic-embed";

// ─── OLLAMA EMBEDDING FUNCTION ───────────────────────────────
/**
 * Generate embedding using Ollama (local model, on-premise)
 * Model: snowflake-arctic-embed
 */
async function generateEmbeddingFromOllama(text: string): Promise<number[]> {
  try {
    const response = await fetch(
      `${OLLAMA_BASE_URL}/api/embed`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: text,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Ollama API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json() as any;

    if (!data.embeddings || !Array.isArray(data.embeddings) || data.embeddings.length === 0) {
      throw new Error("Invalid embedding response from Ollama");
    }

    // Return first embedding from array
    return data.embeddings[0];
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to generate embedding from Ollama: ${errMsg}\n` +
      `Make sure Ollama is running at ${OLLAMA_BASE_URL} with model ${EMBEDDING_MODEL}`
    );
  }
}

// ─── TYPES ───────────────────────────────────────────────────
export interface MedicineRecord {
  id: string;
  nama: string;
  restriksi: string;
  peresepan: string;
  smf: string;
  content: string; // Combined text for embedding
  vector: number[]; // Embedding vector
}

// ─── QUOTE-AWARE CSV PARSER ──────────────────────────────────
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

function unquote(str: string): string {
  str = str.trim();
  if (str.startsWith('"') && str.endsWith('"')) {
    return str.slice(1, -1).trim();
  }
  return str;
}

// ─── LOAD CSV DATA ───────────────────────────────────────────

/**
 * Pre-process CSV text to join multi-line quoted fields.
 * Some fields (e.g., WARFARIN #24, SOROQUIN #95) have newlines inside quoted values.
 */
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

function loadCSVData(): MedicineRecord[] {
  const csvPath = path.join(
    process.cwd(),
    "data",
    "DAFTAR OBAT KRONIS RSI SURABAYA.csv"
  );

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found at: ${csvPath}`);
  }

  const text = fs.readFileSync(csvPath, "utf-8");
  // Pre-process: join multi-line quoted fields before parsing
  const lines = joinMultiLineQuotedFields(text);
  const records: MedicineRecord[] = [];
  let lastEntry: MedicineRecord | null = null;
  let recordId = 0;

  for (const raw of lines) {
    const line = raw.trim();

    // Skip empty lines and headers
    if (!line || line.startsWith("DAFTAR") || line.startsWith("NO.")) continue;

    const cols = splitCsvLine(line);

    const no = unquote(cols[0] ?? "").trim();
    const nama = unquote(cols[1] ?? "").trim().replace(/\*/g, "");
    const restriksi = unquote(cols[2] ?? "").trim();
    const peresepan = unquote(cols[3] ?? "").trim();
    const smf = unquote(cols[4] ?? "").trim();

    if (nama && no) {
      // New numbered medicine entry
      recordId++;
      const record: MedicineRecord = {
        id: `med_${recordId}`,
        nama: nama,
        restriksi: restriksi || "-",
        peresepan: peresepan || "-",
        smf: smf || "-",
        content: `${nama} | ${restriksi || "-"} | ${peresepan || "-"} | ${smf || "-"}`,
        vector: [],
      };

      records.push(record);
      lastEntry = record;
    } else if (nama && !no && lastEntry) {
      // Variant row (different dosage of same medicine, e.g., ALLOPURINOL 300MG)
      recordId++;
      const record: MedicineRecord = {
        id: `med_${recordId}`,
        nama: nama,
        restriksi: restriksi || lastEntry.restriksi,
        peresepan: peresepan || lastEntry.peresepan,
        smf: smf || lastEntry.smf,
        content: `${nama} | ${restriksi || lastEntry.restriksi} | ${peresepan || lastEntry.peresepan} | ${smf || lastEntry.smf}`,
        vector: [],
      };

      records.push(record);
      lastEntry = record;
    } else if (!nama && restriksi && lastEntry) {
      // Fill-down: continuation row
      if (lastEntry.restriksi === "-") {
        lastEntry.restriksi = restriksi;
      } else {
        lastEntry.restriksi += " " + restriksi;
      }
      // Update content with new restriksi
      lastEntry.content = `${lastEntry.nama} | ${lastEntry.restriksi} | ${lastEntry.peresepan} | ${lastEntry.smf}`;
    }
  }

  return records;
}

// ─── GENERATE EMBEDDINGS ─────────────────────────────────────
async function generateEmbeddings(
  records: MedicineRecord[]
): Promise<MedicineRecord[]> {
  console.log(`📚 Generating embeddings for ${records.length} medicines using Ollama...`);
  console.log(`   Model: ${EMBEDDING_MODEL}`);
  console.log(`   Endpoint: ${OLLAMA_BASE_URL}`);

  const recordsWithEmbeddings: MedicineRecord[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    if (!record) continue;

    try {
      const embedding = await generateEmbeddingFromOllama(record.content);

      recordsWithEmbeddings.push({
        ...record,
        vector: embedding,
      });

      // Log progress every 10 records
      if ((i + 1) % 10 === 0) {
        console.log(`  ✓ Embedded ${i + 1}/${records.length} medicines`);
      }
    } catch (error) {
      const medName = record?.nama || "Unknown";
      console.error(`Error embedding medicine ${medName}:`, error);
      throw error;
    }
  }

  console.log(`✅ All ${recordsWithEmbeddings.length} medicines embedded using Ollama`);
  return recordsWithEmbeddings;
}

// ─── INITIALIZE LANCEDB ──────────────────────────────────────
async function initializeDatabase(): Promise<void> {
  try {
    console.log("🚀 Initializing LanceDB for DARSI Apoteker...");

    // Load CSV data
    console.log("📖 Loading CSV data...");
    const records = loadCSVData();
    console.log(`✅ Loaded ${records.length} medicines from CSV`);

    // Generate embeddings
    const recordsWithEmbeddings = await generateEmbeddings(records);

    // Ensure directory exists
    if (!LANCEDB_URI.startsWith("lancedb+")) {
      const dir = path.dirname(LANCEDB_URI);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Created directory: ${dir}`);
      }
    }

    // Connect to LanceDB
    console.log(`📦 Connecting to LanceDB at ${LANCEDB_URI}...`);
    const db = await connect(LANCEDB_URI);

    // Check if table exists
    const tableNames = await db.tableNames();
    if (tableNames.includes(TABLE_NAME)) {
      console.log(`🔄 Table "${TABLE_NAME}" already exists. Overwriting...`);
      await db.dropTable(TABLE_NAME);
    }

    // Create table with embeddings
    console.log(`📋 Creating table "${TABLE_NAME}"...`);
    const dataForTable = recordsWithEmbeddings.map(r => ({
      id: r.id,
      nama: r.nama,
      restriksi: r.restriksi,
      peresepan: r.peresepan,
      smf: r.smf,
      content: r.content,
      vector: r.vector,
    }));
    await db.createTable(TABLE_NAME, dataForTable);

    console.log(`✅ Table "${TABLE_NAME}" created with ${recordsWithEmbeddings.length} records`);

    // Create vector index for optimization (optional)
    try {
      const table = await db.openTable(TABLE_NAME);
      // Index the vector column for faster search
      await table.createIndex("vector");
      console.log("🔍 Vector index created for faster search");
    } catch (indexError) {
      console.warn("⚠️  Could not create vector index (optional):", indexError);
    }

    console.log(
      "\n══════════════════════════════════════════════════════════════"
    );
    console.log("✅ DARSI Apoteker Vector Database initialized successfully!");
    console.log(`📊 Total medicines embedded: ${recordsWithEmbeddings.length}`);
    console.log(`📍 Database location: ${LANCEDB_URI}`);
    console.log(`📋 Table name: ${TABLE_NAME}`);
    console.log(
      "══════════════════════════════════════════════════════════════\n"
    );
  } catch (error) {
    console.error("❌ Error initializing database:", error);
    process.exit(1);
  }
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  initializeDatabase().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { initializeDatabase };
