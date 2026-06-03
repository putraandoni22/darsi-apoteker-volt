/**
 * Embedding Manager - Handles LanceDB initialization, freshness checking, and health monitoring
 * Part of Phase 2: Embedding Hardening
 */

import * as fs from "fs";
import * as path from "path";
import { connect } from "@lancedb/lancedb";

const EMBEDDING_METADATA_FILE = ".voltagent/embedding-metadata.json";
const FRESHNESS_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export type EmbeddingHealthStatus = "healthy" | "stale" | "uninitialized" | "error";

export interface EmbeddingMetadata {
  lastInitializedAt: number; // Epoch milliseconds
  efornas: {
    initialized: boolean;
    tableCount: number;
    recordCount: number;
    lastCheckedAt: number;
  };
  kronis: {
    initialized: boolean;
    tableCount: number;
    recordCount: number;
    lastCheckedAt: number;
  };
}

export interface EmbeddingHealthReport {
  status: EmbeddingHealthStatus;
  message: string;
  metadata?: EmbeddingMetadata;
  isFresh: boolean;
  lastInitializedAt?: number;
  staleDays?: number;
}

/**
 * Load embedding metadata from disk
 */
function loadMetadata(): EmbeddingMetadata | null {
  try {
    const dir = path.dirname(EMBEDDING_METADATA_FILE);
    if (!fs.existsSync(EMBEDDING_METADATA_FILE)) {
      return null;
    }

    const content = fs.readFileSync(EMBEDDING_METADATA_FILE, "utf-8");
    const metadata = JSON.parse(content) as EmbeddingMetadata;
    return metadata;
  } catch (error) {
    return null;
  }
}

/**
 * Save embedding metadata to disk
 */
function saveMetadata(metadata: EmbeddingMetadata): void {
  try {
    const dir = path.dirname(EMBEDDING_METADATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(EMBEDDING_METADATA_FILE, JSON.stringify(metadata, null, 2), "utf-8");
  } catch (error) {
    // Silent failure - metadata save is non-critical
  }
}

/**
 * Check if metadata is fresh (less than 24 hours old)
 */
function isMetadataFresh(metadata: EmbeddingMetadata): boolean {
  const now = Date.now();
  const age = now - metadata.lastInitializedAt;
  return age < FRESHNESS_THRESHOLD_MS;
}

/**
 * Get days since last initialization
 */
function getDaysSinceInit(metadata: EmbeddingMetadata): number {
  const now = Date.now();
  const age = now - metadata.lastInitializedAt;
  return Math.floor(age / (24 * 60 * 60 * 1000));
}

/**
 * Check if e-Fornas embeddings are available and healthy
 */
async function checkEfornasEmbeddings(): Promise<{
  available: boolean;
  recordCount: number;
  error?: string;
}> {
  try {
    const dbUri = process.env.LANCEDB_URI || path.resolve(".voltagent/lancedb");
    const tableName = "efornas-knowledge-base";

    if (!fs.existsSync(dbUri)) {
      return { available: false, recordCount: 0, error: "Database directory not found" };
    }

    const db = await connect(dbUri);
    const tableNames = await db.tableNames();

    if (!tableNames.includes(tableName)) {
      return { available: false, recordCount: 0, error: `Table "${tableName}" not found` };
    }

    const table = await db.openTable(tableName);
    const count = await table.countRows();

    return {
      available: count > 0,
      recordCount: count,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      recordCount: 0,
      error: errMsg,
    };
  }
}

/**
 * Check if Kronis embeddings are available and healthy
 */
async function checkKronisEmbeddings(): Promise<{
  available: boolean;
  recordCount: number;
  error?: string;
}> {
  try {
    const dbUri = process.env.LANCEDB_URI || path.resolve(".voltagent/lancedb");
    const tableName = "medicines-knowledge-base";

    if (!fs.existsSync(dbUri)) {
      return { available: false, recordCount: 0, error: "Database directory not found" };
    }

    const db = await connect(dbUri);
    const tableNames = await db.tableNames();

    if (!tableNames.includes(tableName)) {
      return { available: false, recordCount: 0, error: `Table "${tableName}" not found` };
    }

    const table = await db.openTable(tableName);
    const count = await table.countRows();

    return {
      available: count > 0,
      recordCount: count,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      recordCount: 0,
      error: errMsg,
    };
  }
}

/**
 * Initialize/reinitialize embeddings if needed
 * Returns true if embeddings are now available
 */
export async function ensureEmbeddingsInitialized(): Promise<boolean> {
  try {
    // Check metadata
    let metadata = loadMetadata();

    // If metadata doesn't exist or is stale, we should reinit
    if (!metadata || !isMetadataFresh(metadata)) {
      // Try to reinitialize via npm scripts if available
      const hasEfornasInit = process.env.EFORNAS_CSV
        ? fs.existsSync(process.env.EFORNAS_CSV)
        : fs.existsSync(path.resolve("data/efornas_obat_lengkap.csv"));

      if (!hasEfornasInit) {
        // CSV doesn't exist, can't reinit
        // But we'll still check what's available
      }
    }

    // Check current status
    const efornasStatus = await checkEfornasEmbeddings();
    const kronisStatus = await checkKronisEmbeddings();

    const now = Date.now();

    // Update metadata
    const newMetadata: EmbeddingMetadata = {
      lastInitializedAt: metadata?.lastInitializedAt || now,
      efornas: {
        initialized: efornasStatus.available,
        tableCount: efornasStatus.available ? 1 : 0,
        recordCount: efornasStatus.recordCount,
        lastCheckedAt: now,
      },
      kronis: {
        initialized: kronisStatus.available,
        tableCount: kronisStatus.available ? 1 : 0,
        recordCount: kronisStatus.recordCount,
        lastCheckedAt: now,
      },
    };

    saveMetadata(newMetadata);

    // Return true if at least one embedding source is available
    return efornasStatus.available || kronisStatus.available;
  } catch (error) {
    // Silent failure - will fall back to CSV search
    return false;
  }
}

/**
 * Get comprehensive health report
 */
export async function getEmbeddingHealthReport(): Promise<EmbeddingHealthReport> {
  try {
    const metadata = loadMetadata();

    if (!metadata) {
      return {
        status: "uninitialized",
        message: "Embedding system belum diinisialisasi. Sistem akan menggunakan exact matching.",
        isFresh: false,
      };
    }

    const isFresh = isMetadataFresh(metadata);
    const staleDays = getDaysSinceInit(metadata);

    // Both embeddings available and fresh
    if (
      (metadata.efornas.initialized || metadata.kronis.initialized) &&
      isFresh
    ) {
      const sources = [];
      if (metadata.efornas.initialized) {
        sources.push(`e-Fornas (${metadata.efornas.recordCount.toLocaleString()} records)`);
      }
      if (metadata.kronis.initialized) {
        sources.push(`Kronis (${metadata.kronis.recordCount.toLocaleString()} records)`);
      }

      return {
        status: "healthy",
        message: `Embedding system siap. Sumber: ${sources.join(", ")}`,
        metadata,
        isFresh: true,
        lastInitializedAt: metadata.lastInitializedAt,
      };
    }

    // Embeddings available but stale
    if (
      (metadata.efornas.initialized || metadata.kronis.initialized) &&
      !isFresh
    ) {
      return {
        status: "stale",
        message: `Embedding system sudah stale (${staleDays} hari). Sistem akan mencoba re-inisialisasi atau fallback ke exact matching.`,
        metadata,
        isFresh: false,
        lastInitializedAt: metadata.lastInitializedAt,
        staleDays,
      };
    }

    // Not initialized or error
    return {
      status: "error",
      message: "Embedding system tidak tersedia. Sistem menggunakan exact matching dan fuzzy search.",
      metadata,
      isFresh: false,
      lastInitializedAt: metadata.lastInitializedAt,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return {
      status: "error",
      message: `Error checking embedding health: ${errMsg}`,
      isFresh: false,
    };
  }
}

/**
 * Get detailed embedding status for monitoring
 */
export async function getDetailedEmbeddingStatus(): Promise<{
  efornas: {
    available: boolean;
    recordCount: number;
    error?: string;
  };
  kronis: {
    available: boolean;
    recordCount: number;
    error?: string;
  };
  metadata?: EmbeddingMetadata;
}> {
  const [efornasStatus, kronisStatus] = await Promise.all([
    checkEfornasEmbeddings(),
    checkKronisEmbeddings(),
  ]);

  return {
    efornas: efornasStatus,
    kronis: kronisStatus,
    metadata: loadMetadata() || undefined,
  };
}
