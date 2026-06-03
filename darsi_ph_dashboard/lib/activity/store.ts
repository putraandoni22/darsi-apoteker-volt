import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PublicUser } from "@/lib/auth/store";
import type {
  ActivityActorRole,
  ActivityLevel,
  ActivityLogEntry,
} from "@/lib/activity/types";

interface ActivityStore {
  logs: ActivityLogEntry[];
}

export interface LogActivityInput {
  module: string;
  action: string;
  detail: string;
  level?: ActivityLevel;
  actorId?: string;
  actorName?: string;
  actorRole?: ActivityActorRole;
  user?: Pick<PublicUser, "id" | "name" | "role"> | null;
  request?: Request;
}

export interface ListActivityLogsOptions {
  limit?: number;
  level?: ActivityLevel | "ALL";
  module?: string;
  action?: string;
  search?: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "activity-logs.json");
const MAX_STORED_LOGS = 3000;
const MAX_QUERY_LIMIT = 500;
let writeQueue: Promise<void> = Promise.resolve();

function sanitizeText(value: unknown, maxLength: number, fallback = "-"): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

  return normalized.length > 0 ? normalized : fallback;
}

function sanitizeAction(value: unknown): string {
  const text = sanitizeText(value, 64, "UNKNOWN").toUpperCase();
  const normalized = text.replace(/[^A-Z0-9:_-]/g, "_");
  return normalized.length > 0 ? normalized : "UNKNOWN";
}

function sanitizeModule(value: unknown): string {
  const text = sanitizeText(value, 48, "SYSTEM").toUpperCase();
  const normalized = text.replace(/[^A-Z0-9:_-]/g, "_");
  return normalized.length > 0 ? normalized : "SYSTEM";
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 100;
  }

  const normalized = Math.floor(value ?? 100);
  if (normalized < 1) {
    return 1;
  }

  return Math.min(normalized, MAX_QUERY_LIMIT);
}

function readFirstHeaderValue(request: Request, name: string): string {
  const raw = request.headers.get(name);
  if (!raw) {
    return "";
  }

  const first = raw
    .split(",")
    .map((value) => value.trim())
    .find(Boolean);

  return first || "";
}

export function getClientIp(request: Request): string {
  const forwardedFor = readFirstHeaderValue(request, "x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.slice(0, 64);
  }

  const realIp = readFirstHeaderValue(request, "x-real-ip");
  if (realIp) {
    return realIp.slice(0, 64);
  }

  return "unknown";
}

export function getUserAgent(request: Request): string {
  const userAgent = request.headers.get("user-agent")?.trim() || "unknown";
  return sanitizeText(userAgent, 220, "unknown");
}

function normalizeActorRole(value: unknown): ActivityActorRole {
  if (value === "admin" || value === "apoteker" || value === "pasien") {
    return value;
  }

  if (value === "guest") {
    return "guest";
  }

  return "system";
}

function normalizeLogEntry(value: unknown): ActivityLogEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Partial<ActivityLogEntry>;
  if (typeof entry.id !== "string" || typeof entry.timestamp !== "string") {
    return null;
  }

  const parsedTime = Date.parse(entry.timestamp);
  if (!Number.isFinite(parsedTime)) {
    return null;
  }

  const level: ActivityLevel =
    entry.level === "WARN" || entry.level === "ERROR" ? entry.level : "INFO";

  return {
    id: sanitizeText(entry.id, 80, `ACT-${randomUUID().slice(0, 8)}`),
    timestamp: new Date(parsedTime).toISOString(),
    level,
    module: sanitizeModule(entry.module),
    action: sanitizeAction(entry.action),
    actorId: sanitizeText(entry.actorId, 80),
    actorName: sanitizeText(entry.actorName, 120),
    actorRole: normalizeActorRole(entry.actorRole),
    detail: sanitizeText(entry.detail, 420),
    ip: sanitizeText(entry.ip, 80, "unknown"),
    userAgent: sanitizeText(entry.userAgent, 220, "unknown"),
  };
}

async function ensureStoreFile(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    await readFile(STORE_FILE, "utf-8");
  } catch {
    const initialStore: ActivityStore = { logs: [] };
    await writeFile(STORE_FILE, JSON.stringify(initialStore, null, 2), "utf-8");
  }
}

async function readStore(): Promise<ActivityStore> {
  await ensureStoreFile();

  try {
    const content = await readFile(STORE_FILE, "utf-8");
    const parsed = JSON.parse(content) as Partial<ActivityStore>;

    if (!Array.isArray(parsed.logs)) {
      return { logs: [] };
    }

    return {
      logs: parsed.logs
        .map((entry) => normalizeLogEntry(entry))
        .filter((entry): entry is ActivityLogEntry => Boolean(entry))
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        ),
    };
  } catch {
    return { logs: [] };
  }
}

async function writeStore(store: ActivityStore): Promise<void> {
  await ensureStoreFile();
  const tempFile = `${STORE_FILE}.tmp`;
  await writeFile(tempFile, JSON.stringify(store, null, 2), "utf-8");
  await rename(tempFile, STORE_FILE);
}

async function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const previousWrite = writeQueue;
  let releaseCurrentWrite!: () => void;

  writeQueue = new Promise<void>((resolve) => {
    releaseCurrentWrite = resolve;
  });

  await previousWrite;

  try {
    return await operation();
  } finally {
    releaseCurrentWrite();
  }
}

function matchesSearch(entry: ActivityLogEntry, term: string): boolean {
  if (!term) {
    return true;
  }

  const haystack = [
    entry.module,
    entry.action,
    entry.actorName,
    entry.actorRole,
    entry.detail,
    entry.ip,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(term);
}

export async function logActivity(input: LogActivityInput): Promise<ActivityLogEntry> {
  return withWriteLock(async () => {
    const store = await readStore();

    const actorRole = normalizeActorRole(input.user?.role ?? input.actorRole);
    const actorName = sanitizeText(
      input.user?.name ?? input.actorName,
      120,
      actorRole === "guest" ? "Guest" : "System",
    );

    const entry: ActivityLogEntry = {
      id: `ACT-${randomUUID().slice(0, 8).toUpperCase()}`,
      timestamp: new Date().toISOString(),
      level: input.level ?? "INFO",
      module: sanitizeModule(input.module),
      action: sanitizeAction(input.action),
      actorId: sanitizeText(input.user?.id ?? input.actorId, 80),
      actorName,
      actorRole,
      detail: sanitizeText(input.detail, 420),
      ip: input.request ? getClientIp(input.request) : "unknown",
      userAgent: input.request ? getUserAgent(input.request) : "unknown",
    };

    store.logs = [entry, ...store.logs].slice(0, MAX_STORED_LOGS);
    await writeStore(store);

    return entry;
  });
}

export async function logActivitySafe(input: LogActivityInput): Promise<void> {
  try {
    await logActivity(input);
  } catch (error) {
    console.error("[ActivityLog] Failed to write entry", error);
  }
}

export async function listActivityLogs(
  options: ListActivityLogsOptions = {},
): Promise<ActivityLogEntry[]> {
  const store = await readStore();
  const normalizedLevel = options.level === "ALL" ? undefined : options.level;
  const normalizedModule = options.module?.trim().toUpperCase();
  const normalizedAction = options.action?.trim().toUpperCase();
  const normalizedSearch = options.search?.trim().toLowerCase() ?? "";

  const filtered = store.logs.filter((entry) => {
    if (normalizedLevel && entry.level !== normalizedLevel) {
      return false;
    }

    if (normalizedModule && entry.module !== normalizedModule) {
      return false;
    }

    if (normalizedAction && entry.action !== normalizedAction) {
      return false;
    }

    if (!matchesSearch(entry, normalizedSearch)) {
      return false;
    }

    return true;
  });

  const limit = clampLimit(options.limit);
  return filtered.slice(0, limit);
}

export async function seedSystemActivityIfEmpty(): Promise<void> {
  const store = await readStore();
  if (store.logs.length > 0) {
    return;
  }

  await logActivitySafe({
    module: "SYSTEM",
    action: "ACTIVITY_LOG_INITIALIZED",
    detail: "Sistem audit aktivitas diinisialisasi.",
    actorRole: "system",
  });
}
