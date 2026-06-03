import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getAdminOperationsStatus,
  refreshAdminOperationsStatus,
  reindexKnowledgeBaseDocuments,
  runDataSourceSync,
  runSchemaValidation,
  setVectorSyncSchedule,
} from "@/lib/admin/operations-store";
import { logActivitySafe } from "@/lib/activity/store";
import { getApiAuthenticatedUser } from "@/lib/auth/guards";
import {
  checkRateLimit,
  createRateLimitExceededResponse,
  withRateLimitHeaders,
} from "@/lib/auth/rateLimit";
import { createCsrfBlockedResponse, hasValidSameOrigin } from "@/lib/auth/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ADMIN_OPERATIONS_RATE_LIMIT = { windowMs: 60_000, max: 40 };

type AdminOperationAction =
  | "sync-all-data"
  | "validate-schema"
  | "refresh-status"
  | "reindex-vectors"
  | "partial-reindex"
  | "schedule-vector-sync"
  | "disable-vector-sync";

function isAdminAction(value: string): value is AdminOperationAction {
  return (
    value === "sync-all-data" ||
    value === "validate-schema" ||
    value === "refresh-status" ||
    value === "reindex-vectors" ||
    value === "partial-reindex" ||
    value === "schedule-vector-sync" ||
    value === "disable-vector-sync"
  );
}

async function requireAdminUser(request: NextRequest) {
  const user = await getApiAuthenticatedUser(request);
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (user.role !== "admin") {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return {
    ok: true as const,
    user,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminUser(request);
  if (!auth.ok) {
    return auth.response;
  }

  const status = await getAdminOperationsStatus();

  return NextResponse.json({ status });
}

export async function POST(request: NextRequest) {
  if (!hasValidSameOrigin(request)) {
    await logActivitySafe({
      level: "WARN",
      module: "ADMIN_OPERATIONS",
      action: "POST_CSRF_BLOCKED",
      detail: "Operasi admin ditolak karena validasi origin gagal.",
      actorRole: "guest",
      request,
    });
    return createCsrfBlockedResponse();
  }

  const rateLimit = checkRateLimit(request, "admin:operations:post", ADMIN_OPERATIONS_RATE_LIMIT);
  if (!rateLimit.allowed) {
    await logActivitySafe({
      level: "WARN",
      module: "ADMIN_OPERATIONS",
      action: "POST_RATE_LIMITED",
      detail: "Operasi admin diblokir karena melebihi batas rate limit.",
      actorRole: "guest",
      request,
    });
    return createRateLimitExceededResponse(rateLimit);
  }

  const respond = (body: unknown, status = 200) =>
    withRateLimitHeaders(NextResponse.json(body, { status }), rateLimit);

  const auth = await requireAdminUser(request);
  if (!auth.ok) {
    return respond(
      { error: auth.response.status === 401 ? "Unauthorized" : "Forbidden" },
      auth.response.status,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respond({ error: "Request body tidak valid." }, 400);
  }

  if (!body || typeof body !== "object") {
    return respond({ error: "Request body tidak valid." }, 400);
  }

  const actionRaw = (body as { action?: unknown }).action;
  const action = typeof actionRaw === "string" ? actionRaw.trim() : "";

  if (!isAdminAction(action)) {
    return respond({ error: "Aksi operasi admin tidak dikenali." }, 400);
  }

  try {
    let result: unknown = null;
    let message = "Operasi admin berhasil diproses.";

    if (action === "sync-all-data") {
      result = await runDataSourceSync();
      message = "Sinkronisasi semua data selesai.";
    } else if (action === "validate-schema") {
      result = await runSchemaValidation();
      message = "Validasi skema selesai dijalankan.";
    } else if (action === "refresh-status") {
      result = await refreshAdminOperationsStatus();
      message = "Status operasi admin diperbarui.";
    } else if (action === "reindex-vectors") {
      result = await reindexKnowledgeBaseDocuments();
      message = "Re-index vector knowledge base selesai.";
    } else if (action === "partial-reindex") {
      const documentIdsRaw = (body as { documentIds?: unknown }).documentIds;
      const documentIds = Array.isArray(documentIdsRaw)
        ? documentIdsRaw
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        : [];

      result = await reindexKnowledgeBaseDocuments({ documentIds });
      message = "Re-index parsial knowledge base selesai.";
    } else if (action === "schedule-vector-sync") {
      result = await setVectorSyncSchedule({ enabled: true });
      message = "Jadwal sinkronisasi vector diaktifkan.";
    } else {
      result = await setVectorSyncSchedule({ enabled: false });
      message = "Jadwal sinkronisasi vector dinonaktifkan.";
    }

    const status = await getAdminOperationsStatus();

    await logActivitySafe({
      module: "ADMIN_OPERATIONS",
      action: `ACTION_${action.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
      detail: message,
      user: {
        id: auth.user.id,
        name: auth.user.name,
        role: auth.user.role,
      },
      request,
    });

    return respond({ message, result, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operasi admin gagal diproses.";

    await logActivitySafe({
      level: "ERROR",
      module: "ADMIN_OPERATIONS",
      action: `ACTION_${action.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_FAILED`,
      detail: message,
      user: {
        id: auth.user.id,
        name: auth.user.name,
        role: auth.user.role,
      },
      request,
    });

    return respond({ error: message }, 500);
  }
}
