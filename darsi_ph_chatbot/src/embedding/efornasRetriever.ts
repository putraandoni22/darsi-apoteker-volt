import * as path from "path";
import { connect } from "@lancedb/lancedb";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const EMBEDDING_MODEL = "snowflake-arctic-embed";
const MAX_EMBED_CHARS = 480;

export interface EfornasSearchResult {
  id: string;
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
  restriksi_obat: string;
  restriksi_sediaan: string;
  peresepan_maksimal: string;
  score: number;
}

async function generateEmbeddingFromOllama(text: string): Promise<number[]> {
  const truncated = text.length > MAX_EMBED_CHARS ? text.slice(0, MAX_EMBED_CHARS) : text;
  const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: truncated }),
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

export class EfornasRetriever {
  private dbUri: string;
  private tableName = "efornas-knowledge-base";
  private cachedDb: any = null;

  constructor(dbUri?: string) {
    this.dbUri = dbUri || path.resolve(".voltagent/lancedb");
  }

  private async getDatabase() {
    if (!this.cachedDb) {
      this.cachedDb = await connect(this.dbUri);
    }
    return this.cachedDb;
  }

  private async getTable() {
    const db = await this.getDatabase();
    const tableNames = await db.tableNames();
    if (!tableNames.includes(this.tableName)) {
      throw new Error(`Table "${this.tableName}" not found. Run 'npm run init-efornas' first.`);
    }
    return await db.openTable(this.tableName);
  }

  private mapResult(result: any): EfornasSearchResult {
    return {
      id: result.id || "",
      nama_obat: result.nama_obat || "",
      nama_obat_internasional: result.nama_obat_internasional || "",
      kelas_terapi: result.kelas_terapi || "",
      sub_kelas_terapi: result.sub_kelas_terapi || "",
      sub_sub_kelas_terapi: result.sub_sub_kelas_terapi || "",
      sub_sub_sub_kelas_terapi: result.sub_sub_sub_kelas_terapi || "",
      sediaan: result.sediaan || "",
      kekuatan: result.kekuatan || "",
      satuan: result.satuan || "",
      fpktp: result.fpktp || "",
      fpktl: result.fpktl || "",
      pp: result.pp || "",
      prb: result.prb || "",
      oen: result.oen || "",
      program: result.program || "",
      kanker: result.kanker || "",
      komposisi: result.komposisi || "",
      restriksi_obat: result.restriksi_obat || "",
      restriksi_sediaan: result.restriksi_sediaan || "",
      peresepan_maksimal: result.peresepan_maksimal || "",
      score: result._distance ? 1 - result._distance : 0.5,
    };
  }

  /** Semantic search by query text */
  async search(query: string, limit = 10): Promise<EfornasSearchResult[]> {
    const embedding = await generateEmbeddingFromOllama(query);
    const table = await this.getTable();
    const results = await table.vectorSearch(embedding).limit(limit).toArray();
    return results.map((r: any) => this.mapResult(r));
  }

  /** Keyword search by drug name */
  async searchByName(name: string, limit = 10): Promise<EfornasSearchResult[]> {
    const table = await this.getTable();
    const sanitized = name.replace(/[^a-zA-Z0-9 .,()]/g, "").toLowerCase();
    if (!sanitized.trim()) {
      return [];
    }
    const results = await table
      .query()
      .where(
        `lower(nama_obat) LIKE '%${sanitized}%' OR lower(nama_obat_internasional) LIKE '%${sanitized}%'`
      )
      .limit(limit)
      .toArray();
    return results.map((r: any) => ({ ...this.mapResult(r), score: 1.0 }));
  }

  /** Search by kelas terapi */
  async searchByKelas(kelas: string, limit = 20): Promise<EfornasSearchResult[]> {
    const embedding = await generateEmbeddingFromOllama(`kelas terapi ${kelas}`);
    const table = await this.getTable();
    const results = await table.vectorSearch(embedding).limit(limit).toArray();
    return results.map((r: any) => this.mapResult(r));
  }

  /**
   * Fuzzy search by drug name using token-based matching
   * Handles typos and partial matches better than exact substring
   */
  async searchByNameFuzzy(name: string, limit = 10): Promise<EfornasSearchResult[]> {
    try {
      const table = await this.getTable();
      const sanitized = name.replace(/[^a-zA-Z0-9 .,()]/g, "").toLowerCase().trim();
      
      if (!sanitized) {
        return [];
      }

      const tokens = sanitized.split(/\s+/).filter((t: string) => t.length >= 2);
      
      // First try: exact substring match (fastest)
      const exactResults = await table
        .query()
        .where(
          `lower(nama_obat) LIKE '%${sanitized}%' OR lower(nama_obat_internasional) LIKE '%${sanitized}%'`
        )
        .limit(limit)
        .toArray();

      if (exactResults.length > 0) {
        return exactResults.map((r: any) => ({ ...this.mapResult(r), score: 1.0 }));
      }

      // Second try: token-based partial match (handles word order variations)
      if (tokens.length > 0) {
        const tokenWhere = tokens
          .map((token: string) => `lower(nama_obat) LIKE '%${token}%' OR lower(nama_obat_internasional) LIKE '%${token}%'`)
          .join(" OR ");
        
        const tokenResults = await table
          .query()
          .where(tokenWhere)
          .limit(limit * 2)
          .toArray();

        if (tokenResults.length > 0) {
          // Score by number of matching tokens
          const scored = tokenResults.map((r: any) => {
            const fullText = ((r.nama_obat || "") + " " + (r.nama_obat_internasional || "")).toLowerCase();
            const matchCount = tokens.filter((t: string) => fullText.includes(t)).length;
            return { ...this.mapResult(r), score: Math.min(1, matchCount / tokens.length) };
          });
          
          // Sort by score descending
          scored.sort((a, b) => (b.score || 0) - (a.score || 0));
          return scored.slice(0, limit);
        }
      }

      return [];
    } catch (error) {
      // If fuzzy search fails, return empty (will fallback to semantic)
      return [];
    }
  }

  /**
   * Search by drug ID/code (e.g., "1666" or "EFR-01666")
   * e-Fornas CSV has ID field in first column
   */
  async searchById(id: string, limit = 5): Promise<EfornasSearchResult[]> {
    try {
      const table = await this.getTable();
      // Normalize ID: remove non-digit chars, then match
      const normalizedId = id.replace(/[^0-9]/g, "").trim();
      
      if (!normalizedId || normalizedId.length < 2) {
        return [];
      }

      const results = await table
        .query()
        .where(`id = '${normalizedId}'`)
        .limit(limit)
        .toArray();

      if (results.length > 0) {
        return results.map((r: any) => ({ ...this.mapResult(r), score: 1.0 }));
      }

      // If exact ID not found, try prefix match
      const prefixResults = await table
        .query()
        .where(`id LIKE '${normalizedId}%'`)
        .limit(limit)
        .toArray();

      return prefixResults.map((r: any) => ({ ...this.mapResult(r), score: 0.9 }));
    } catch (error) {
      // If ID search fails silently, return empty
      return [];
    }
  }

  /** Check if table exists */
  async isAvailable(): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const tableNames = await db.tableNames();
      return tableNames.includes(this.tableName);
    } catch {
      return false;
    }
  }
}
