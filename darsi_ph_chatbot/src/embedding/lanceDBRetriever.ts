import * as path from "path";
import { connect } from "@lancedb/lancedb";
import * as fs from "fs";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const EMBEDDING_MODEL = "snowflake-arctic-embed";

export interface SearchResult {
  id: string;
  nama: string;
  restriksi: string;
  peresepan: string;
  smf: string;
  score: number; // Similarity score
}

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

export class LanceDBRetriever {
  private dbUri: string;
  private tableName = "medicines-knowledge-base";
  private initialized = false;
  private cachedDb: any = null; // Cache database connection

  constructor(dbUri?: string) {
    this.dbUri = dbUri || path.resolve(".voltagent/lancedb");
  }

  /**
   * Get or create cached database connection (lazy loading)
   * Reuses same connection for all operations to avoid overhead
   */
  private async getDatabase() {
    if (!this.cachedDb) {
      this.cachedDb = await connect(this.dbUri);
    }
    return this.cachedDb;
  }

  /**
   * Get fresh table reference from cached database
   * Table objects are created fresh each time for reliability
   */
  private async getTable() {
    const db = await this.getDatabase();
    const tableNames = await db.tableNames();
    if (!tableNames.includes(this.tableName)) {
      throw new Error(
        `Table "${this.tableName}" not found. Run initialization first.`
      );
    }
    return await db.openTable(this.tableName);
  }

  /**
   * Perform semantic search on medicines using vector similarity
   * Uses Ollama for embedding generation (on-premise)
   * @param query - Search query (e.g., "vitamin b untuk defisiensi")
   * @param limit - Max results to return (default 5)
   * @returns Array of matching medicines with similarity scores
   */
  async search(query: string, limit = 5): Promise<SearchResult[]> {
    try {
      // Generate embedding using Ollama
      const embedding = await generateEmbeddingFromOllama(query);

      // Get cached table
      const table = await this.getTable();

      // Perform vector search
      const results = await table
        .vectorSearch(embedding)
        .limit(limit)
        .toArray();

      // Format results
      const searchResults: SearchResult[] = results.map((result: any) => ({
        id: result.id,
        nama: result.nama,
        restriksi: result.restriksi,
        peresepan: result.peresepan,
        smf: result.smf,
        score: result._distance ? 1 - result._distance : 0.5, // convert distance to similarity
      }));

      return searchResults;
    } catch (error) {
      console.error("Error searching medicines:", error);
      throw error;
    }
  }

  /**
   * Perform keyword search (exact/fuzzy matching)
   * This is faster than semantic search for specific medicine names
   */
  async searchByName(medName: string, limit = 5): Promise<SearchResult[]> {
    try {
      const table = await this.getTable();

      // Sanitize input: only allow alphanumeric, spaces, commas, periods, parentheses
      const sanitized = medName.replace(/[^a-zA-Z0-9 .,()]/g, "").toUpperCase();
      const allRecords = await (table as any)
        .query()
        .where(`upper(nama) LIKE '%${sanitized}%'`)
        .limit(limit)
        .toArray();

      const searchResults: SearchResult[] = allRecords.map((result: any) => ({
        id: result.id || '',
        nama: result.nama || '',
        restriksi: result.restriksi || '',
        peresepan: result.peresepan || '',
        smf: result.smf || '',
        score: 1.0, // Exact match
      })).filter((r: SearchResult) => r !== undefined);

      return searchResults;
    } catch (error) {
      // If filtering fails, return empty and caller will use semantic search
      console.warn("Name search failed, will fallback to semantic search:", error);
      return [];
    }
  }

  /**
   * Get all medicines from database
   * Fallback to CSV if LanceDB not available (simpler and more reliable)
   */
  async getAllMedicines(limit = 999): Promise<SearchResult[]> {
    try {
      // Try to use LanceDB search with empty embedding (basic query)
      const db = await this.getDatabase();
      const tableNames = await db.tableNames();
      
      if (tableNames.includes(this.tableName)) {
        const table = await db.openTable(this.tableName);
        // Use search with a generic embedding to get results
        const genericEmbedding = await generateEmbeddingFromOllama("obat");
        const results = await table
          .vectorSearch(genericEmbedding)
          .limit(limit)
          .toArray();
        
        return results.map((result: any) => ({
          id: result.id || '',
          nama: result.nama || '',
          restriksi: result.restriksi || '',
          peresepan: result.peresepan || '',
          smf: result.smf || '',
          score: 1.0,
        })).filter((m: SearchResult | null | undefined) => m !== null && m !== undefined);
      } else {
        // Fallback to CSV if table doesn't exist
        throw new Error("Table not initialized");
      }
    } catch (error) {
      // Fallback to CSV loading for "list all"
      console.warn("LanceDB getAllMedicines failed, fallback to CSV:", 
        error instanceof Error ? error.message : String(error));
      
      try {
        const csvPath = path.resolve("./data/DAFTAR OBAT KRONIS RSI SURABAYA.csv");
        const csvContent = fs.readFileSync(csvPath, "utf-8");
        const lines = csvContent.split("\n");
        
        const medicines: SearchResult[] = [];
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i]?.trim();
          if (!line || line.startsWith("DAFTAR") || line.startsWith("NO.") || line.startsWith(";;;;")) continue;
          const values = line.split(";");
          const nama = (values[1] ?? "").replace(/"/g, "").replace(/\*/g, "").trim();
          if (!nama) continue;
          medicines.push({
            id: String(i),
            nama: nama,
            restriksi: (values[2] ?? "").replace(/"/g, "").trim() || "-",
            peresepan: (values[3] ?? "").replace(/"/g, "").trim() || "-",
            smf: (values[4] ?? "").replace(/"/g, "").trim() || "-",
            score: 1.0,
          });
          if (medicines.length >= limit) break;
        }
        return medicines;
      } catch (csvError) {
        console.error("CSV fallback also failed:", csvError);
        return [];
      }
    }
  }

  /**
   * Get single medicine by exact name
   */
  async getMedicineByName(medName: string): Promise<SearchResult | null> {
    const results = await this.searchByName(medName, 1);
    if (results && results.length > 0) {
      const result = results[0];
      return result || null;
    }
    return null;
  }
}

// Export singleton instance
export const retriever = new LanceDBRetriever();
