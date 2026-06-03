import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface PasswordResetTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

interface PasswordResetStore {
  tokens: PasswordResetTokenRecord[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const TOKENS_FILE = path.join(DATA_DIR, "auth-password-resets.json");
const RESET_EXPIRATION_MINUTES = 30;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function ensureTokenStoreFile(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    await readFile(TOKENS_FILE, "utf-8");
  } catch {
    const initial: PasswordResetStore = { tokens: [] };
    await writeFile(TOKENS_FILE, JSON.stringify(initial, null, 2), "utf-8");
  }
}

async function readTokenStore(): Promise<PasswordResetStore> {
  await ensureTokenStoreFile();
  const content = await readFile(TOKENS_FILE, "utf-8");

  try {
    const parsed = JSON.parse(content) as Partial<PasswordResetStore>;
    if (!Array.isArray(parsed.tokens)) {
      return { tokens: [] };
    }

    return {
      tokens: parsed.tokens.filter(
        (token): token is PasswordResetTokenRecord =>
          Boolean(token?.id) &&
          Boolean(token?.userId) &&
          Boolean(token?.tokenHash) &&
          Boolean(token?.createdAt) &&
          Boolean(token?.expiresAt) &&
          (token?.usedAt === null || typeof token?.usedAt === "string"),
      ),
    };
  } catch {
    return { tokens: [] };
  }
}

async function writeTokenStore(store: PasswordResetStore): Promise<void> {
  await ensureTokenStoreFile();
  await writeFile(TOKENS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESET_EXPIRATION_MINUTES * 60 * 1000);

  const store = await readTokenStore();

  store.tokens = store.tokens.filter((token) => token.usedAt === null && !isExpired(token.expiresAt));
  store.tokens.push({
    id: randomUUID(),
    userId,
    tokenHash: hashToken(rawToken),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    usedAt: null,
  });

  await writeTokenStore(store);
  return rawToken;
}

export async function consumePasswordResetToken(token: string): Promise<string | null> {
  const tokenHash = hashToken(token);
  const store = await readTokenStore();

  const match = store.tokens.find(
    (item) => item.tokenHash === tokenHash && item.usedAt === null && !isExpired(item.expiresAt),
  );

  if (!match) {
    return null;
  }

  match.usedAt = new Date().toISOString();
  await writeTokenStore(store);

  return match.userId;
}
