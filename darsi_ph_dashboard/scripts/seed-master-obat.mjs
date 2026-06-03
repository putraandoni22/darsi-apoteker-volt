import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const MAX_TEST_ROWS = 100;

function splitCsvLineByDelimiter(line, delimiter = ",") {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current.trim());
  return fields;
}

function joinMultilineCsvRecords(text) {
  const rawLines = text.split(/\r?\n/);
  const joined = [];
  let buffer = "";
  let inQuotes = false;

  for (const line of rawLines) {
    if (buffer.length === 0) {
      buffer = line;
    } else {
      buffer += `\n${line}`;
    }

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char !== '"') {
        continue;
      }

      if (line[index + 1] === '"') {
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
    }

    if (!inQuotes) {
      const normalized = buffer.trim();
      if (normalized.length > 0) {
        joined.push(normalized);
      }
      buffer = "";
    }
  }

  if (buffer.trim().length > 0) {
    joined.push(buffer.trim());
  }

  return joined;
}

function normalizeCsvValue(value) {
  if (!value) {
    return "";
  }

  return value
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/""/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCsvHeader(value) {
  return normalizeCsvValue(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeKey(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function pickCategory(...candidates) {
  for (const candidate of candidates) {
    const value = normalizeCsvValue(candidate);
    if (value.length > 0) {
      return value;
    }
  }

  return "umum";
}

function mapKronisRows(rawCsv) {
  const records = joinMultilineCsvRecords(rawCsv);
  if (records.length === 0) {
    return [];
  }

  const headers = splitCsvLineByDelimiter(records[0] ?? "", ",");
  const headerMap = new Map();
  headers.forEach((header, index) => {
    headerMap.set(normalizeCsvHeader(header), index);
  });

  const namaIndex = headerMap.get("nama") ?? 1;
  const smfIndex = headerMap.get("smf") ?? 4;

  const mapped = [];
  for (const record of records.slice(1)) {
    const columns = splitCsvLineByDelimiter(record, ",");
    const namaObat = normalizeCsvValue(columns[namaIndex]);
    if (!namaObat) {
      continue;
    }

    mapped.push({
      namaObat,
      kategori: pickCategory(columns[smfIndex], "KRONIS_RSI"),
      source: "kronis_rsi",
    });
  }

  return mapped;
}

function mapEfornasRows(rawCsv) {
  const records = joinMultilineCsvRecords(rawCsv);
  if (records.length === 0) {
    return [];
  }

  const headers = splitCsvLineByDelimiter(records[0] ?? "", ",");
  const headerMap = new Map();
  headers.forEach((header, index) => {
    headerMap.set(normalizeCsvHeader(header), index);
  });

  const namaIndex = headerMap.get("namaobat") ?? 1;
  const kelasIndex = headerMap.get("kelasterapi") ?? 3;
  const subKelasIndex = headerMap.get("subkelasterapi") ?? 4;
  const subSubKelasIndex = headerMap.get("subsubkelasterapi") ?? 5;
  const subSubSubKelasIndex = headerMap.get("subsubsubkelasterapi") ?? 6;

  const mapped = [];
  for (const record of records.slice(1)) {
    const columns = splitCsvLineByDelimiter(record, ",");
    const namaObat = normalizeCsvValue(columns[namaIndex]);
    if (!namaObat) {
      continue;
    }

    const kategori = pickCategory(
      columns[kelasIndex],
      columns[subKelasIndex],
      columns[subSubKelasIndex],
      columns[subSubSubKelasIndex],
      "EFORNAS",
    );

    mapped.push({
      namaObat,
      kategori,
      source: "efornas",
    });
  }

  return mapped;
}

function dedupeRows(rows) {
  const deduped = [];
  const seen = new Set();

  for (const row of rows) {
    const key = `${normalizeKey(row.namaObat)}|${normalizeKey(row.kategori)}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

function dedupeAndLimitRows(kronisRows, efornasRows, maxRows) {
  const kronisDeduped = dedupeRows(kronisRows);
  const efornasDeduped = dedupeRows(efornasRows);
  const selected = [];
  const seenGlobal = new Set();

  let kronisIndex = 0;
  let efornasIndex = 0;
  let preferKronis = true;

  while (
    selected.length < maxRows &&
    (kronisIndex < kronisDeduped.length || efornasIndex < efornasDeduped.length)
  ) {
    let candidate = null;

    if (preferKronis) {
      candidate = kronisDeduped[kronisIndex] ?? efornasDeduped[efornasIndex] ?? null;
      if (kronisDeduped[kronisIndex]) {
        kronisIndex += 1;
      } else if (efornasDeduped[efornasIndex]) {
        efornasIndex += 1;
      }
    } else {
      candidate = efornasDeduped[efornasIndex] ?? kronisDeduped[kronisIndex] ?? null;
      if (efornasDeduped[efornasIndex]) {
        efornasIndex += 1;
      } else if (kronisDeduped[kronisIndex]) {
        kronisIndex += 1;
      }
    }

    preferKronis = !preferKronis;

    if (!candidate) {
      continue;
    }

    const key = `${normalizeKey(candidate.namaObat)}|${normalizeKey(candidate.kategori)}`;
    if (seenGlobal.has(key)) {
      continue;
    }

    seenGlobal.add(key);
    selected.push(candidate);
  }

  return selected;
}

function resolveRepoRoot() {
  const scriptPath = fileURLToPath(import.meta.url);
  const scriptDir = path.dirname(scriptPath);
  return path.resolve(scriptDir, "..", "..");
}

function resolveDbUrl(repoRoot) {
  const explicitDemo = process.env.DEMO_LIBSQL_DATABASE_URL?.trim();
  if (explicitDemo) {
    return explicitDemo;
  }

  const explicitShared = process.env.LIBSQL_DATABASE_URL?.trim();
  if (explicitShared) {
    return explicitShared;
  }

  return `file:${path.join(repoRoot, "ui", "data", "demo-workflows.db")}`;
}

async function ensureMasterObatTable(client) {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS master_obat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama_obat VARCHAR(255) NOT NULL,
      kategori VARCHAR(120) NOT NULL DEFAULT 'umum'
    )
  `);
}

async function getExistingMasterObatKeys(client) {
  const result = await client.execute("SELECT nama_obat, kategori FROM master_obat");
  const keys = new Set();

  for (const row of result.rows) {
    const namaObat = normalizeCsvValue(String(row.nama_obat ?? ""));
    const kategori = normalizeCsvValue(String(row.kategori ?? ""));
    if (!namaObat || !kategori) {
      continue;
    }

    keys.add(`${normalizeKey(namaObat)}|${normalizeKey(kategori)}`);
  }

  return keys;
}

async function seedMasterObat(rows, client, existingKeys) {
  let inserted = 0;
  let skipped = 0;

  await client.execute("BEGIN");

  try {
    for (const row of rows) {
      const key = `${normalizeKey(row.namaObat)}|${normalizeKey(row.kategori)}`;
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }

      await client.execute({
        sql: "INSERT INTO master_obat (nama_obat, kategori) VALUES (?, ?)",
        args: [row.namaObat, row.kategori],
      });

      existingKeys.add(key);
      inserted += 1;
    }

    await client.execute("COMMIT");
  } catch (error) {
    await client.execute("ROLLBACK");
    throw error;
  }

  return { inserted, skipped };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const repoRoot = resolveRepoRoot();
  const kronisCsvPath = path.join(repoRoot, "data", "DAFTAR_OBAT_KRONIS_CLEAN.csv");
  const efornasCsvPath = path.join(repoRoot, "data", "efornas_obat_lengkap.csv");

  const [kronisRaw, efornasRaw] = await Promise.all([
    readFile(kronisCsvPath, "utf-8"),
    readFile(efornasCsvPath, "utf-8"),
  ]);

  const kronisRows = mapKronisRows(kronisRaw);
  const efornasRows = mapEfornasRows(efornasRaw);
  const seedRows = dedupeAndLimitRows(kronisRows, efornasRows, MAX_TEST_ROWS);

  if (seedRows.length === 0) {
    throw new Error("Tidak ada data valid untuk di-seed ke master_obat.");
  }

  const dbUrl = resolveDbUrl(repoRoot);
  const authToken = process.env.DEMO_LIBSQL_AUTH_TOKEN?.trim() || process.env.LIBSQL_AUTH_TOKEN?.trim() || undefined;

  const client = createClient({
    url: dbUrl,
    ...(authToken ? { authToken } : {}),
  });

  await ensureMasterObatTable(client);

  const existingKeys = await getExistingMasterObatKeys(client);
  let inserted = 0;
  let skipped = 0;

  if (!dryRun) {
    const seedResult = await seedMasterObat(seedRows, client, existingKeys);
    inserted = seedResult.inserted;
    skipped = seedResult.skipped;
  }

  const countResult = await client.execute("SELECT COUNT(*) AS total FROM master_obat");
  const totalAfterSeed = Number(countResult.rows[0]?.total ?? 0);

  const sourceSummary = seedRows.reduce(
    (acc, row) => {
      if (row.source === "kronis_rsi") {
        acc.kronis += 1;
      } else if (row.source === "efornas") {
        acc.efornas += 1;
      }
      return acc;
    },
    { kronis: 0, efornas: 0 },
  );

  console.log("Seed master_obat selesai.");
  console.log(`Mode: ${dryRun ? "dry-run" : "apply"}`);
  console.log(`DB URL: ${dbUrl}`);
  console.log(`Rows diproses (maks ${MAX_TEST_ROWS}): ${seedRows.length}`);
  console.log(`- Sumber kronis_rsi: ${sourceSummary.kronis}`);
  console.log(`- Sumber efornas: ${sourceSummary.efornas}`);
  if (!dryRun) {
    console.log(`- Inserted: ${inserted}`);
    console.log(`- Skipped (sudah ada): ${skipped}`);
  }
  console.log(`Total rows master_obat saat ini: ${totalAfterSeed}`);

  const preview = seedRows.slice(0, 5);
  console.log("Preview mapping (5 baris pertama):");
  for (const row of preview) {
    console.log(`- ${row.namaObat} | ${row.kategori}`);
  }
}

main().catch((error) => {
  console.error("Seed master_obat gagal:", error);
  process.exitCode = 1;
});
