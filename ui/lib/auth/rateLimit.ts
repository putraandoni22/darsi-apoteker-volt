import { NextResponse } from "next/server";

interface RateLimitOptions {
  windowMs: number;
  max: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKET_ENTRIES = 5000;

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return "unknown";
}

function cleanupExpiredBuckets(now: number): void {
  if (buckets.size <= MAX_BUCKET_ENTRIES) {
    return;
  }

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function checkRateLimit(
  request: Request,
  scope: string,
  options: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  cleanupExpiredBuckets(now);

  const ip = getClientIp(request);
  const key = `${scope}:${ip}`;

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = {
      count: 0,
      resetAt: now + options.windowMs,
    };
  }

  if (bucket.count >= options.max) {
    buckets.set(key, bucket);

    return {
      allowed: false,
      limit: options.max,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      resetAt: bucket.resetAt,
    };
  }

  bucket.count += 1;
  buckets.set(key, bucket);

  return {
    allowed: true,
    limit: options.max,
    remaining: Math.max(0, options.max - bucket.count),
    retryAfterSeconds: 0,
    resetAt: bucket.resetAt,
  };
}

export function withRateLimitHeaders(
  response: NextResponse,
  result: RateLimitResult,
): NextResponse {
  response.headers.set("X-RateLimit-Limit", String(result.limit));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set("X-RateLimit-Reset", String(Math.floor(result.resetAt / 1000)));
  if (!result.allowed && result.retryAfterSeconds > 0) {
    response.headers.set("Retry-After", String(result.retryAfterSeconds));
  }

  return response;
}

export function createRateLimitExceededResponse(
  result: RateLimitResult,
): NextResponse {
  const response = NextResponse.json(
    { error: "Terlalu banyak percobaan. Coba lagi beberapa saat lagi." },
    { status: 429 },
  );

  return withRateLimitHeaders(response, result);
}
