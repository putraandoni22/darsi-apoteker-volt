import { NextResponse } from "next/server";

const SAME_ORIGIN_ERROR_MESSAGE =
  "Permintaan ditolak karena validasi keamanan origin gagal.";

function readHeaderValue(request: Request, name: string): string | null {
  const raw = request.headers.get(name);
  if (!raw) {
    return null;
  }

  const first = raw
    .split(",")
    .map((value) => value.trim())
    .find(Boolean);

  return first || null;
}

function toOrigin(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function resolveSourceOrigin(request: Request): string | null {
  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");

  const origin = toOrigin(originHeader);
  if (origin) {
    return origin;
  }

  const refererOrigin = toOrigin(refererHeader);
  if (refererOrigin) {
    return refererOrigin;
  }

  return null;
}

function normalizeProtocol(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/:$/, "");
  if (normalized === "http" || normalized === "https") {
    return normalized;
  }

  return null;
}

function collectAllowedOrigins(request: Request): Set<string> {
  const allowedOrigins = new Set<string>();
  const targetUrl = new URL(request.url);
  allowedOrigins.add(targetUrl.origin);

  const hostCandidates = [
    readHeaderValue(request, "x-forwarded-host"),
    readHeaderValue(request, "x-original-host"),
    readHeaderValue(request, "host"),
  ].filter((value): value is string => Boolean(value));

  const protocolCandidates = [
    normalizeProtocol(readHeaderValue(request, "x-forwarded-proto")),
    normalizeProtocol(readHeaderValue(request, "x-forwarded-protocol")),
    normalizeProtocol(readHeaderValue(request, "x-forwarded-scheme")),
    normalizeProtocol(targetUrl.protocol),
  ].filter((value): value is string => Boolean(value));

  for (const host of hostCandidates) {
    for (const protocol of protocolCandidates) {
      const candidate = toOrigin(`${protocol}://${host}`);
      if (candidate) {
        allowedOrigins.add(candidate);
      }
    }
  }

  const forwardedOrigin = toOrigin(readHeaderValue(request, "x-forwarded-origin"));
  if (forwardedOrigin) {
    allowedOrigins.add(forwardedOrigin);
  }

  const envCandidates = [
    process.env.AUTH_ALLOWED_ORIGINS,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .flatMap((value) => value.split(",").map((item) => item.trim()))
    .filter(Boolean);

  for (const envOrigin of envCandidates) {
    const normalized = toOrigin(envOrigin);
    if (normalized) {
      allowedOrigins.add(normalized);
    }
  }

  return allowedOrigins;
}

export function hasValidSameOrigin(request: Request): boolean {
  const sourceOrigin = resolveSourceOrigin(request);
  if (!sourceOrigin) {
    return false;
  }

  const allowedOrigins = collectAllowedOrigins(request);
  return allowedOrigins.has(sourceOrigin);
}

export function createCsrfBlockedResponse(): NextResponse {
  return NextResponse.json({ error: SAME_ORIGIN_ERROR_MESSAGE }, { status: 403 });
}
