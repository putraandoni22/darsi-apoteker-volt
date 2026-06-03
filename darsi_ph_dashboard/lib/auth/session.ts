import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { findUserById, toPublicUser, type PublicUser } from "@/lib/auth/store";

export { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const DEV_FALLBACK_SESSION_SECRET = "darsi-apoteker-dev-secret-change-me";
const MIN_PRODUCTION_SECRET_LENGTH = 32;
let warnedDevFallbackSecret = false;

interface SessionPayload {
  sub: string;
  exp: number;
}

function resolveSessionSecret(): string {
  const configuredSecret = process.env.AUTH_SESSION_SECRET?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  if (configuredSecret) {
    if (isProduction && configuredSecret === DEV_FALLBACK_SESSION_SECRET) {
      throw new Error("AUTH_SESSION_SECRET must not use the development fallback value in production");
    }

    if (isProduction && configuredSecret.length < MIN_PRODUCTION_SECRET_LENGTH) {
      throw new Error(
        `AUTH_SESSION_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`
      );
    }

    return configuredSecret;
  }

  if (isProduction) {
    throw new Error("AUTH_SESSION_SECRET must be set in production");
  }

  if (!warnedDevFallbackSecret) {
    warnedDevFallbackSecret = true;
    console.warn(
      "[auth] AUTH_SESSION_SECRET is not set. Using a development fallback secret."
    );
  }

  return DEV_FALLBACK_SESSION_SECRET;
}

let cachedSessionSecret: string | null = null;

function getSessionSecret(): string {
  if (cachedSessionSecret) {
    return cachedSessionSecret;
  }

  cachedSessionSecret = resolveSessionSecret();
  return cachedSessionSecret;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf-8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  const base64 = remainder === 0 ? padded : `${padded}${"=".repeat(4 - remainder)}`;
  return Buffer.from(base64, "base64").toString("utf-8");
}

function signPayload(encodedPayload: string): string {
  const signature = createHmac("sha256", getSessionSecret())
    .update(encodedPayload)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return signature;
}

function signaturesMatch(signature: string, expectedSignature: string): boolean {
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(signatureBuffer, expectedBuffer);
}

export function createSessionToken(userId: string): string {
  const payload: SessionPayload = {
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);
  if (!signaturesMatch(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as SessionPayload;
    if (!payload.sub || !payload.exp) {
      return null;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSeconds) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export async function getCurrentUserFromRequest(
  request: NextRequest,
): Promise<PublicUser | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  const payload = verifySessionToken(token);
  if (!payload) {
    return null;
  }

  const user = await findUserById(payload.sub);
  return user ? toPublicUser(user) : null;
}

export async function getCurrentUserFromCookies(): Promise<PublicUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  const payload = verifySessionToken(token);
  if (!payload) {
    return null;
  }

  const user = await findUserById(payload.sub);
  return user ? toPublicUser(user) : null;
}
