import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  deleteKnowledgeBaseDocument,
  getAdminOperationsStatus,
  listKnowledgeBaseDocuments,
  reindexKnowledgeBaseDocuments,
  setVectorSyncSchedule,
  updateKnowledgeBaseDocument,
  uploadKnowledgeBaseDocument,
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

const KB_MUTATION_RATE_LIMIT = { windowMs: 60_000, max: 30 };
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

type KnowledgeBaseAction =
  | "upload-document"
  | "update-document"
  | "delete-document"
  | "reindex-all"
  | "partial-reindex"
  | "schedule-vector-sync"
  | "disable-vector-sync";

function isKnowledgeBaseAction(value: string): value is KnowledgeBaseAction {
  return (
    value === "upload-document" ||
    value === "update-document" ||
    value === "delete-document" ||
    value === "reindex-all" ||
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

async function buildKnowledgeBasePayload() {
  const [documents, status] = await Promise.all([
    listKnowledgeBaseDocuments(),
    getAdminOperationsStatus(),
  ]);

  return {
    documents,
    vector: status.vector,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminUser(request);
  if (!auth.ok) {
    return auth.response;
  }

  const payload = await buildKnowledgeBasePayload();
  return NextResponse.json(payload);
}

export async function POST(request: NextRequest) {
  if (!hasValidSameOrigin(request)) {
    await logActivitySafe({
      level: "WARN",
      module: "ADMIN_KNOWLEDGE_BASE",
      action: "POST_CSRF_BLOCKED",
      detail: "Operasi knowledge base ditolak karena origin tidak valid.",
      actorRole: "guest",
      request,
    });
    return createCsrfBlockedResponse();
  }

  const rateLimit = checkRateLimit(request, "admin:knowledge-base:post", KB_MUTATION_RATE_LIMIT);
  if (!rateLimit.allowed) {
    await logActivitySafe({
      level: "WARN",
      module: "ADMIN_KNOWLEDGE_BASE",
      action: "POST_RATE_LIMITED",
      detail: "Operasi knowledge base melebihi batas rate limit.",
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

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  try {
    let action: KnowledgeBaseAction;
    let result: unknown = null;
    let message = "Operasi knowledge base berhasil diproses.";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const actionRaw = formData.get("action");
      const actionText = typeof actionRaw === "string" ? actionRaw.trim() : "";

      if (!isKnowledgeBaseAction(actionText)) {
        return respond({ error: "Aksi knowledge base tidak dikenali." }, 400);
      }

      action = actionText;

      if (action !== "upload-document") {
        return respond({ error: "Aksi ini tidak mendukung multipart form data." }, 400);
      }

      const fileValue = formData.get("file");
      if (!(fileValue instanceof File)) {
        return respond({ error: "File dokumen wajib diisi." }, 400);
      }

      const fileBuffer = Buffer.from(await fileValue.arrayBuffer());
      if (fileBuffer.byteLength <= 0) {
        return respond({ error: "File dokumen kosong." }, 400);
      }

      if (fileBuffer.byteLength > MAX_UPLOAD_BYTES) {
        return respond(
          { error: "Ukuran file terlalu besar. Maksimal 20MB per dokumen." },
          400,
        );
      }

      result = await uploadKnowledgeBaseDocument({
        fileName: fileValue.name,
        fileBuffer,
      });
      message = `Dokumen ${fileValue.name} berhasil diunggah.`;
    } else {
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
      const actionText = typeof actionRaw === "string" ? actionRaw.trim() : "";
      if (!isKnowledgeBaseAction(actionText)) {
        return respond({ error: "Aksi knowledge base tidak dikenali." }, 400);
      }

      action = actionText;

      if (action === "update-document") {
        const documentIdRaw = (body as { documentId?: unknown }).documentId;
        const documentId = typeof documentIdRaw === "string" ? documentIdRaw.trim() : "";
        if (!documentId) {
          return respond({ error: "documentId wajib diisi." }, 400);
        }

        result = await updateKnowledgeBaseDocument(documentId);
        message = "Dokumen knowledge base berhasil diperbarui.";
      } else if (action === "delete-document") {
        const documentIdRaw = (body as { documentId?: unknown }).documentId;
        const documentId = typeof documentIdRaw === "string" ? documentIdRaw.trim() : "";
        if (!documentId) {
          return respond({ error: "documentId wajib diisi." }, 400);
        }

        await deleteKnowledgeBaseDocument(documentId);
        message = "Dokumen knowledge base berhasil dihapus.";
      } else if (action === "reindex-all") {
        result = await reindexKnowledgeBaseDocuments();
        message = "Re-index seluruh dokumen knowledge base selesai.";
      } else if (action === "partial-reindex") {
        const idsRaw = (body as { documentIds?: unknown }).documentIds;
        const documentIds = Array.isArray(idsRaw)
          ? idsRaw
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter(Boolean)
          : [];

        if (documentIds.length === 0) {
          return respond({ error: "Minimal satu documentId harus dipilih." }, 400);
        }

        result = await reindexKnowledgeBaseDocuments({ documentIds });
        message = "Re-index parsial dokumen knowledge base selesai.";
      } else if (action === "schedule-vector-sync") {
        result = await setVectorSyncSchedule({ enabled: true });
        message = "Jadwal sinkronisasi vector diaktifkan.";
      } else if (action === "disable-vector-sync") {
        result = await setVectorSyncSchedule({ enabled: false });
        message = "Jadwal sinkronisasi vector dinonaktifkan.";
      } else {
        return respond({ error: "Aksi upload membutuhkan multipart form data." }, 400);
      }
    }

    const payload = await buildKnowledgeBasePayload();

    await logActivitySafe({
      module: "ADMIN_KNOWLEDGE_BASE",
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
    const message = error instanceof Error ? error.message : "Operasi knowledge base gagal.";

    await logActivitySafe({
      level: "ERROR",
      module: "ADMIN_KNOWLEDGE_BASE",
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
