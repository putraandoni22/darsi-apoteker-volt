import { Memory } from "@voltagent/core";
import { LibSQLMemoryAdapter } from "@voltagent/libsql";
import path from "path";
import { fileURLToPath } from "url";
import { getPgPool, resolveSchema } from "../utils/darsiDb.js";
import { PostgresMemoryAdapter } from "./postgresMemoryAdapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Initialize LibSQL Memory for DARSI Apoteker
 * Stores conversation history, user data, and search queries
 */
export function initializeMemory(): Memory {
  const memoryDriver = (process.env.DARSI_MEMORY_DRIVER || "libsql").toLowerCase();
  const pgPool = memoryDriver === "postgres" ? getPgPool("DARSI_MEMORY_DB") : null;
  const pgSchema = resolveSchema("DARSI_MEMORY_DB_SCHEMA", "darsi_ph_memory");
  const tablePrefix = (process.env.DARSI_MEMORY_TABLE_PREFIX || "darsi_apoteker").trim() || "darsi_apoteker";

  if (pgPool) {
    const memoryAdapter = new PostgresMemoryAdapter({
      pool: pgPool,
      schema: pgSchema,
      tablePrefix,
      logger: {
        debug: (msg: string) => console.log(`[Memory:DEBUG] ${msg}`),
        info: (msg: string) => console.log(`[Memory:INFO] ${msg}`),
        warn: (msg: string) => console.warn(`[Memory:WARN] ${msg}`),
        error: (msg: string, context?: any) => console.error(`[Memory:ERROR] ${msg}`, context),
      },
    });

    return new Memory({
      storage: memoryAdapter,
      workingMemory: {
        enabled: true,
        scope: "conversation",
        template: `# Context Pencarian Obat\n- Key facts:\n`,
      },
    });
  }

  // Use local SQLite file for development
  // In production, you can switch to remote Turso: process.env.LIBSQL_DATABASE_URL
  const memoryPath = process.env.LIBSQL_DATABASE_URL || 
    `file:${path.join(__dirname, "../.voltagent/memory.db")}`;

  const memoryAdapter = new LibSQLMemoryAdapter({
    url: memoryPath,
    ...(process.env.LIBSQL_AUTH_TOKEN && { authToken: process.env.LIBSQL_AUTH_TOKEN }),
    tablePrefix: "darsi_apoteker",
    logger: {
      debug: (msg: string) => console.log(`[Memory:DEBUG] ${msg}`),
      info: (msg: string) => console.log(`[Memory:INFO] ${msg}`),
      warn: (msg: string) => console.warn(`[Memory:WARN] ${msg}`),
      error: (msg: string, context?: any) => 
        console.error(`[Memory:ERROR] ${msg}`, context),
      trace: (msg: string) => console.log(`[Memory:TRACE] ${msg}`),
      fatal: (msg: string, context?: any) => 
        console.error(`[Memory:FATAL] ${msg}`, context),
      child: (bindings: Record<string, any>) => {
        const childLogger = {
          debug: (msg: string) => console.log(`[Memory:CHILD] ${msg}`),
          info: (msg: string) => console.log(`[Memory:CHILD] ${msg}`),
          warn: (msg: string) => console.warn(`[Memory:CHILD] ${msg}`),
          error: (msg: string, context?: any) => 
            console.error(`[Memory:CHILD] ${msg}`, context),
          trace: (msg: string) => console.log(`[Memory:CHILD] ${msg}`),
          fatal: (msg: string, context?: any) => 
            console.error(`[Memory:CHILD] ${msg}`, context),
          child: (bindings2: Record<string, any>) => childLogger,
        };
        return childLogger;
      },
    } as any,
  });

  const memory = new Memory({
    storage: memoryAdapter,
    // Working memory untuk maintain context yang compact
    workingMemory: {
      enabled: true,
      scope: "conversation",
      template: `# Context Pencarian Obat
- Key facts:
`,
    },
  });

  return memory;
}

/**
 * Get memory statistics
 * Useful for debugging and monitoring
 */
export async function getMemoryStats(memory: Memory) {
  try {
    // This would require additional implementation in LibSQL adapter
    // For now, we'll return basic info
    return {
      status: "active",
      type: "LibSQL SQLite",
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Error getting memory stats:", error);
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
