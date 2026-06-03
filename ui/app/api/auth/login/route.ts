import { NextResponse } from "next/server";
import {
  checkRateLimit,
  createRateLimitExceededResponse,
  withRateLimitHeaders,
} from "@/lib/auth/rateLimit";
import { createCsrfBlockedResponse, hasValidSameOrigin } from "@/lib/auth/security";
import { findUserByEmail, toPublicUser } from "@/lib/auth/store";
import { verifyPassword } from "@/lib/auth/password";
import {
  createSessionToken,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { logActivitySafe } from "@/lib/activity/store";
import { normalizeAuthInput, validateEmail } from "@/lib/auth/validation";

const LOGIN_RATE_LIMIT = { windowMs: 60_000, max: 5 };

export async function POST(request: Request) {
  if (!hasValidSameOrigin(request)) {
    await logActivitySafe({
      level: "WARN",
      module: "AUTH",
      action: "LOGIN_CSRF_BLOCKED",
      detail: "Permintaan login ditolak karena validasi origin gagal.",
      actorRole: "guest",
      request,
    });
    return createCsrfBlockedResponse();
  }

  const rateLimit = checkRateLimit(request, "auth:login", LOGIN_RATE_LIMIT);
  if (!rateLimit.allowed) {
    await logActivitySafe({
      level: "WARN",
      module: "AUTH",
      action: "LOGIN_RATE_LIMITED",
      detail: "Percobaan login melebihi batas rate limit.",
      actorRole: "guest",
      request,
    });
    return createRateLimitExceededResponse(rateLimit);
  }

  const respond = (body: unknown, status = 200) =>
    withRateLimitHeaders(NextResponse.json(body, { status }), rateLimit);

  try {
    const body = await request.json();
    const normalized = normalizeAuthInput({
      email: body?.email ?? "",
      password: body?.password ?? "",
    });

    if (!validateEmail(normalized.email) || !normalized.password) {
      await logActivitySafe({
        level: "WARN",
        module: "AUTH",
        action: "LOGIN_INVALID_INPUT",
        detail: `Input login tidak valid untuk email \"${normalized.email || "-"}\".`,
        actorName: normalized.email || "unknown",
        actorRole: "guest",
        request,
      });
      return respond(
        { error: "Email atau password tidak valid." },
        400,
      );
    }

    const user = await findUserByEmail(normalized.email);
    if (!user || !verifyPassword(normalized.password, user.passwordHash)) {
      await logActivitySafe({
        level: "WARN",
        module: "AUTH",
        action: "LOGIN_FAILED",
        detail: `Login gagal untuk email \"${normalized.email}\".`,
        actorName: normalized.email,
        actorRole: "guest",
        request,
      });
      return respond(
        { error: "Email atau password salah." },
        401,
      );
    }

    const token = createSessionToken(user.id);
    const response = NextResponse.json({ user: toPublicUser(user) });
    response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());

    await logActivitySafe({
      module: "AUTH",
      action: "LOGIN_SUCCESS",
      detail: "Login berhasil.",
      user: { id: user.id, name: user.name, role: user.role },
      request,
    });

    return withRateLimitHeaders(response, rateLimit);
  } catch {
    await logActivitySafe({
      level: "ERROR",
      module: "AUTH",
      action: "LOGIN_ERROR",
      detail: "Terjadi kesalahan internal saat memproses login.",
      actorRole: "guest",
      request,
    });
    return respond(
      { error: "Terjadi kesalahan saat login." },
      500,
    );
  }
}
