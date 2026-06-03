import { NextResponse } from "next/server";
import {
  checkRateLimit,
  createRateLimitExceededResponse,
  withRateLimitHeaders,
} from "@/lib/auth/rateLimit";
import { createCsrfBlockedResponse, hasValidSameOrigin } from "@/lib/auth/security";
import {
  createUser,
  CreateUserConflictError,
  findUserByEmail,
  toPublicUser,
} from "@/lib/auth/store";
import { hashPassword } from "@/lib/auth/password";
import {
  createSessionToken,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { logActivitySafe } from "@/lib/activity/store";
import {
  normalizeRole,
  normalizeAuthInput,
  validateEmail,
  validatePassword,
} from "@/lib/auth/validation";

const REGISTER_RATE_LIMIT = { windowMs: 60_000, max: 5 };

export async function POST(request: Request) {
  if (!hasValidSameOrigin(request)) {
    await logActivitySafe({
      level: "WARN",
      module: "AUTH",
      action: "REGISTER_CSRF_BLOCKED",
      detail: "Permintaan registrasi ditolak karena validasi origin gagal.",
      actorRole: "guest",
      request,
    });
    return createCsrfBlockedResponse();
  }

  const rateLimit = checkRateLimit(request, "auth:register", REGISTER_RATE_LIMIT);
  if (!rateLimit.allowed) {
    await logActivitySafe({
      level: "WARN",
      module: "AUTH",
      action: "REGISTER_RATE_LIMITED",
      detail: "Permintaan registrasi melebihi batas rate limit.",
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
      name: body?.name ?? "",
      email: body?.email ?? "",
      password: body?.password ?? "",
      role: body?.role ?? "apoteker",
    });

    if (!normalized.name || normalized.name.length < 2) {
      await logActivitySafe({
        level: "WARN",
        module: "AUTH",
        action: "REGISTER_INVALID_NAME",
        detail: "Registrasi ditolak karena nama tidak valid.",
        actorName: normalized.email || "unknown",
        actorRole: "guest",
        request,
      });
      return respond(
        { error: "Nama minimal 2 karakter." },
        400,
      );
    }

    if (!validateEmail(normalized.email)) {
      await logActivitySafe({
        level: "WARN",
        module: "AUTH",
        action: "REGISTER_INVALID_EMAIL",
        detail: "Registrasi ditolak karena format email tidak valid.",
        actorName: normalized.email || "unknown",
        actorRole: "guest",
        request,
      });
      return respond(
        { error: "Format email tidak valid." },
        400,
      );
    }

    if (!validatePassword(normalized.password)) {
      await logActivitySafe({
        level: "WARN",
        module: "AUTH",
        action: "REGISTER_INVALID_PASSWORD",
        detail: "Registrasi ditolak karena password tidak memenuhi syarat.",
        actorName: normalized.email,
        actorRole: "guest",
        request,
      });
      return respond(
        { error: "Password minimal 8 karakter." },
        400,
      );
    }

    const existingUser = await findUserByEmail(normalized.email);
    if (existingUser) {
      await logActivitySafe({
        level: "WARN",
        module: "AUTH",
        action: "REGISTER_DUPLICATE_EMAIL",
        detail: `Registrasi ditolak karena email \"${normalized.email}\" sudah terdaftar.`,
        actorName: normalized.email,
        actorRole: "guest",
        request,
      });
      return respond(
        { error: "Email sudah terdaftar." },
        409,
      );
    }

    const user = await createUser({
      name: normalized.name,
      email: normalized.email,
      passwordHash: hashPassword(normalized.password),
      role: normalizeRole(normalized.role),
    });

    const token = createSessionToken(user.id);
    const response = NextResponse.json({ user: toPublicUser(user) }, { status: 201 });
    response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());

    await logActivitySafe({
      module: "AUTH",
      action: "REGISTER_SUCCESS",
      detail: `User baru terdaftar dengan role ${user.role}.`,
      user: { id: user.id, name: user.name, role: user.role },
      request,
    });

    return withRateLimitHeaders(response, rateLimit);
  } catch (error) {
    if (error instanceof CreateUserConflictError) {
      await logActivitySafe({
        level: "WARN",
        module: "AUTH",
        action: "REGISTER_CONFLICT",
        detail: "Registrasi gagal karena email sudah terdaftar.",
        actorRole: "guest",
        request,
      });
      return respond(
        { error: "Email sudah terdaftar." },
        409,
      );
    }

    await logActivitySafe({
      level: "ERROR",
      module: "AUTH",
      action: "REGISTER_ERROR",
      detail: "Terjadi kesalahan internal saat registrasi.",
      actorRole: "guest",
      request,
    });

    return respond(
      { error: "Terjadi kesalahan saat mendaftar." },
      500,
    );
  }
}
