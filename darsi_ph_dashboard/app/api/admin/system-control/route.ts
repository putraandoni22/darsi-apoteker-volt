import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  createSystemBackup,
  getAdminOperationsStatus,
  listSystemBackups,
  readBackupFileForDownload,
  restartLocalServiceSoft,
  restoreSystemBackup,
  toggleMaintenanceMode,
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

const SYSTEM_CONTROL_RATE_LIMIT = { windowMs: 60_000, max: 25 };

type SystemControlAction =
  | "backup-now"
  | "restore-backup"
  | "toggle-maintenance"
  | "restart-local-service";

function isSystemControlAction(value: string): value is SystemControlAction {
  return (
    value === "backup-now" ||
    value === "restore-backup" ||
    value === "toggle-maintenance" ||
    value === "restart-local-service"
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

async function buildSystemControlPayload() {
  const [status, backups] = await Promise.all([
    getAdminOperationsStatus(),
    listSystemBackups(),
  ]);

  return {
    system: status.system,
    backups,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminUser(request);
  if (!auth.ok) {
    return auth.response;
  }

  const downloadId = request.nextUrl.searchParams.get("downloadId")?.trim() ?? "";
  if (downloadId) {
    try {
      const file = await readBackupFileForDownload(downloadId);

      return new NextResponse(file.content, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename=\"${file.fileName}\"`,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Backup tidak ditemukan.";
      return NextResponse.json({ error: message }, { status: 404 });
    }
  }

  const payload = await buildSystemControlPayload();
  return NextResponse.json(payload);
}

export async function POST(request: NextRequest) {
  if (!hasValidSameOrigin(request)) {
    await logActivitySafe({
      level: "WARN",
      module: "ADMIN_SYSTEM_CONTROL",
      action: "POST_CSRF_BLOCKED",
      detail: "Operasi system control ditolak karena origin tidak valid.",
      actorRole: "guest",
      request,
    });
    return createCsrfBlockedResponse();
  }

  const rateLimit = checkRateLimit(request, "admin:system-control:post", SYSTEM_CONTROL_RATE_LIMIT);
  if (!rateLimit.allowed) {
    await logActivitySafe({
      level: "WARN",
      module: "ADMIN_SYSTEM_CONTROL",
      action: "POST_RATE_LIMITED",
      detail: "Operasi system control melebihi batas rate limit.",
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
  if (!isSystemControlAction(action)) {
    return respond({ error: "Aksi system control tidak dikenali." }, 400);
  }

  try {
    let result: unknown = null;
    let message = "Operasi system control berhasil diproses.";

    if (action === "backup-now") {
      result = await createSystemBackup();
      message = "Backup sistem berhasil dibuat.";
    } else if (action === "restore-backup") {
      const backupIdRaw = (body as { backupId?: unknown }).backupId;
      const backupId = typeof backupIdRaw === "string" ? backupIdRaw.trim() : "";
      if (!backupId) {
        return respond({ error: "backupId wajib diisi." }, 400);
      }

      result = await restoreSystemBackup(backupId);
      message = "Restore backup berhasil dijalankan.";
    } else if (action === "toggle-maintenance") {
      const enabledRaw = (body as { enabled?: unknown }).enabled;
      if (typeof enabledRaw !== "boolean") {
        return respond({ error: "enabled wajib bernilai boolean." }, 400);
      }

      result = await toggleMaintenanceMode(enabledRaw);
      message = enabledRaw
        ? "Mode maintenance diaktifkan."
        : "Mode maintenance dinonaktifkan.";
    } else {
      result = await restartLocalServiceSoft();
      message = "Restart service lokal (soft) selesai dijalankan.";
    }

    const payload = await buildSystemControlPayload();

    await logActivitySafe({
      module: "ADMIN_SYSTEM_CONTROL",
      action: `ACTION_${action.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
      detail: message,
      user: {
        id: auth.user.id,
        name: auth.user.name,
        role: auth.user.role,
      },
      request,
    });

    return respond({ message, result, ...payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operasi system control gagal.";

    await logActivitySafe({
      level: "ERROR",
      module: "ADMIN_SYSTEM_CONTROL",
      action: "ACTION_FAILED",
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
