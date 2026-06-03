import { NextResponse, type NextRequest } from "next/server";
import {
  checkRateLimit,
  createRateLimitExceededResponse,
  withRateLimitHeaders,
} from "@/lib/auth/rateLimit";
import { createCsrfBlockedResponse, hasValidSameOrigin } from "@/lib/auth/security";
import { logActivitySafe } from "@/lib/activity/store";
import {
  SESSION_COOKIE_NAME,
  getCurrentUserFromRequest,
  getSessionCookieOptions,
} from "@/lib/auth/session";

const LOGOUT_RATE_LIMIT = { windowMs: 60_000, max: 30 };

export async function POST(request: NextRequest) {
  if (!hasValidSameOrigin(request)) {
    await logActivitySafe({
      level: "WARN",
      module: "AUTH",
      action: "LOGOUT_CSRF_BLOCKED",
      detail: "Permintaan logout ditolak karena validasi origin gagal.",
      actorRole: "guest",
      request,
    });
    return createCsrfBlockedResponse();
  }

  const rateLimit = checkRateLimit(request, "auth:logout", LOGOUT_RATE_LIMIT);
  if (!rateLimit.allowed) {
    await logActivitySafe({
      level: "WARN",
      module: "AUTH",
      action: "LOGOUT_RATE_LIMITED",
      detail: "Permintaan logout melebihi batas rate limit.",
      actorRole: "guest",
      request,
    });
    return createRateLimitExceededResponse(rateLimit);
  }

  const currentUser = await getCurrentUserFromRequest(request);

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    ...getSessionCookieOptions(),
    maxAge: 0,
  });

  await logActivitySafe({
    module: "AUTH",
    action: "LOGOUT_SUCCESS",
    detail: currentUser
      ? "User berhasil logout."
      : "Logout diproses tanpa sesi aktif.",
    user: currentUser
      ? { id: currentUser.id, name: currentUser.name, role: currentUser.role }
      : null,
    actorRole: currentUser ? undefined : "guest",
    request,
  });

  return withRateLimitHeaders(response, rateLimit);
}
