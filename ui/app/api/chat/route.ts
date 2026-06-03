import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { logActivitySafe } from "@/lib/activity/store";

const VOLTAGENT_BACKEND_CANDIDATES = Array.from(
  new Set(
    [
      process.env.VOLTAGENT_BACKEND_URL,
      process.env.NEXT_PUBLIC_VOLTAGENT_URL,
      "http://localhost:1337",
      "http://localhost:4310",
    ].filter((value): value is string => Boolean(value && value.trim()))
  )
);

export async function POST(request: NextRequest) {
  try {
    console.log("[Chat API] Request received");

    // Read authenticated user if available; anonymous traffic is treated as guest mode.
    const user = await getCurrentUserFromRequest(request);
    const isGuest = !user;
    const actor = user ? { id: user.id, name: user.name, role: user.role } : null;

    const contentType = request.headers.get("content-type") || "application/json";
    let body = await request.text();
    let messageCount = 0;
    console.log("[Chat API] Request body length:", body.length);

    if (contentType.includes("application/json")) {
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        messageCount = Array.isArray(parsed.messages) ? parsed.messages.length : 0;
        console.log("[Chat API] Messages count:", messageCount);
        const requestUserId =
          typeof parsed.userId === "string" && parsed.userId.trim().length > 0
            ? parsed.userId.trim()
            : "guest-user";

        body = JSON.stringify({
          ...parsed,
          userId: user?.id ?? requestUserId,
          userRole: user?.role ?? "guest",
          userName: user?.name ?? "",
          namaUser: user?.name ?? "",
          userMode: user
            ? user.role === "apoteker" || user.role === "admin"
              ? "apoteker"
              : "pasien"
            : "guest",
          accessTier: isGuest ? "guest" : "authenticated",
        });
      } catch (e) {
        console.error("[Chat API] JSON parse error:", e);
        // Keep original body if parsing fails
      }
    }

    let upstream: Response | null = null;
    let selectedBackend = "";
    let lastFetchError: unknown = null;

    for (const backend of VOLTAGENT_BACKEND_CANDIDATES) {
      const baseUrl = backend.replace(/\/$/, "");
      const targetUrl = `${baseUrl}/api/chat`;

      try {
        console.log("[Chat API] Forwarding to:", targetUrl);
        const candidateResponse = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "content-type": contentType,
            accept: request.headers.get("accept") || "text/event-stream",
          },
          body,
        });

        // 404 usually means this host is not the expected backend implementation.
        if (candidateResponse.status === 404) {
          console.warn("[Chat API] Backend returned 404, trying next candidate:", targetUrl);
          continue;
        }

        upstream = candidateResponse;
        selectedBackend = targetUrl;
        break;
      } catch (error) {
        lastFetchError = error;
        console.warn("[Chat API] Failed to reach backend candidate:", targetUrl, String(error));
      }
    }

    if (!upstream) {
      console.error("[Chat API] No backend candidate reachable", {
        candidates: VOLTAGENT_BACKEND_CANDIDATES,
        lastFetchError: String(lastFetchError),
      });

      await logActivitySafe({
        level: "ERROR",
        module: "CHAT",
        action: "CHAT_BACKEND_UNAVAILABLE",
        detail: `Permintaan chat gagal karena backend tidak dapat dijangkau. Pesan: ${messageCount}.`,
        user: actor,
        actorRole: actor ? undefined : "guest",
        request,
      });

      return NextResponse.json(
        {
          error: "Backend service unavailable",
          details: String(lastFetchError || "No backend candidate responded"),
          candidates: VOLTAGENT_BACKEND_CANDIDATES,
        },
        { status: 502 }
      );
    }

    console.log("[Chat API] Using backend:", selectedBackend, "status:", upstream.status);

    // Handle non-streaming responses (errors, etc)
    if (!upstream.ok) {
      const errorText = await upstream.text();
      console.error(`[Chat API] Backend error: ${upstream.status} - ${errorText}`);

      await logActivitySafe({
        level: "WARN",
        module: "CHAT",
        action: "CHAT_BACKEND_ERROR",
        detail: `Backend chat merespons status ${upstream.status}. Pesan: ${messageCount}.`,
        user: actor,
        actorRole: actor ? undefined : "guest",
        request,
      });

      return NextResponse.json(
        { error: "Backend service error", status: upstream.status, details: errorText },
        { status: upstream.status }
      );
    }

    // Handle streaming responses
    const responseHeaders = new Headers();
    const upstreamContentType = upstream.headers.get("content-type");
    if (upstreamContentType) {
      responseHeaders.set("content-type", upstreamContentType);
    }
    responseHeaders.set("cache-control", "no-cache");
    responseHeaders.set("connection", "keep-alive");

    // Forward the stream directly
    if (upstream.body) {
      console.log("[Chat API] Streaming response to client");

      await logActivitySafe({
        module: "CHAT",
        action: "CHAT_STREAM_SUCCESS",
        detail: `Permintaan chat berhasil diproses oleh ${selectedBackend}. Pesan: ${messageCount}.`,
        user: actor,
        actorRole: actor ? undefined : "guest",
        request,
      });

      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      });
    } else {
      console.error("[Chat API] No response body from backend");

      await logActivitySafe({
        level: "ERROR",
        module: "CHAT",
        action: "CHAT_EMPTY_RESPONSE",
        detail: "Backend chat merespons tanpa body.",
        user: actor,
        actorRole: actor ? undefined : "guest",
        request,
      });

      return NextResponse.json(
        { error: "No response body from backend" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("[Chat API] Unexpected error:", error);

    await logActivitySafe({
      level: "ERROR",
      module: "CHAT",
      action: "CHAT_UNEXPECTED_ERROR",
      detail: "Terjadi kesalahan tidak terduga pada endpoint chat.",
      actorRole: "system",
      request,
    });

    return NextResponse.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 }
    );
  }
}
