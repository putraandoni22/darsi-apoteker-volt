import { NextResponse } from "next/server";
import {
  checkRateLimit,
  createRateLimitExceededResponse,
  withRateLimitHeaders,
} from "@/lib/auth/rateLimit";
import { createCsrfBlockedResponse, hasValidSameOrigin } from "@/lib/auth/security";
import { logActivitySafe } from "@/lib/activity/store";
import { consumePasswordResetToken } from "@/lib/auth/passwordReset";
import { hashPassword } from "@/lib/auth/password";
import { updateUserPassword } from "@/lib/auth/store";
import { validatePassword } from "@/lib/auth/validation";

const RESET_PASSWORD_RATE_LIMIT = { windowMs: 60_000, max: 10 };

export async function POST(request: Request) {
  if (!hasValidSameOrigin(request)) {
    await logActivitySafe({
      level: "WARN",
      module: "AUTH",
      action: "RESET_PASSWORD_CSRF_BLOCKED",
      detail: "Permintaan reset password ditolak karena validasi origin gagal.",
      actorRole: "guest",
      request,
    });
    return createCsrfBlockedResponse();
  }

  const rateLimit = checkRateLimit(
    request,
    "auth:reset-password",
    RESET_PASSWORD_RATE_LIMIT,
  );
  if (!rateLimit.allowed) {
    await logActivitySafe({
      level: "WARN",
      module: "AUTH",
      action: "RESET_PASSWORD_RATE_LIMITED",
      detail: "Permintaan reset password melebihi batas rate limit.",
      actorRole: "guest",
      request,
    });
    return createRateLimitExceededResponse(rateLimit);
  }

  const respond = (body: unknown, status = 200) =>
    withRateLimitHeaders(NextResponse.json(body, { status }), rateLimit);

  try {
    const body = await request.json();
    const token = String(body?.token ?? "").trim();
    const password = String(body?.password ?? "");

    if (!token) {
      await logActivitySafe({
        level: "WARN",
        module: "AUTH",
        action: "RESET_PASSWORD_INVALID_TOKEN_INPUT",
        detail: "Permintaan reset password ditolak karena token kosong.",
        actorRole: "guest",
        request,
      });
      return respond({ error: "Token reset tidak valid." }, 400);
    }

    if (!validatePassword(password)) {
      await logActivitySafe({
        level: "WARN",
        module: "AUTH",
        action: "RESET_PASSWORD_INVALID_PASSWORD",
        detail: "Permintaan reset password ditolak karena password tidak memenuhi syarat.",
        actorRole: "guest",
        request,
      });
      return respond(
        { error: "Password minimal 8 karakter." },
        400,
      );
    }

    const userId = await consumePasswordResetToken(token);
    if (!userId) {
      await logActivitySafe({
        level: "WARN",
        module: "AUTH",
        action: "RESET_PASSWORD_TOKEN_EXPIRED",
        detail: "Reset password gagal karena token sudah tidak berlaku.",
        actorRole: "guest",
        request,
      });
      return respond(
        { error: "Token reset sudah tidak berlaku." },
        400,
      );
    }

    const updatedUser = await updateUserPassword(userId, hashPassword(password));
    if (!updatedUser) {
      await logActivitySafe({
        level: "WARN",
        module: "AUTH",
        action: "RESET_PASSWORD_USER_NOT_FOUND",
        detail: "Reset password gagal karena user tidak ditemukan.",
        actorId: userId,
        actorRole: "system",
        request,
      });
      return respond(
        { error: "User tidak ditemukan." },
        404,
      );
    }

    await logActivitySafe({
      module: "AUTH",
      action: "RESET_PASSWORD_SUCCESS",
      detail: "Password pengguna berhasil diubah.",
      user: { id: updatedUser.id, name: updatedUser.name, role: updatedUser.role },
      request,
    });

    return respond({ success: true, message: "Password berhasil diubah." });
  } catch {
    await logActivitySafe({
      level: "ERROR",
      module: "AUTH",
      action: "RESET_PASSWORD_ERROR",
      detail: "Terjadi kesalahan internal saat reset password.",
      actorRole: "guest",
      request,
    });
    return respond(
      { error: "Terjadi kesalahan saat reset password." },
      500,
    );
  }
}
