import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getApiAuthenticatedUser } from "@/lib/auth/guards";
import { listActivityLogs, seedSystemActivityIfEmpty } from "@/lib/activity/store";
import type { ActivityLevel } from "@/lib/activity/types";

export const dynamic = "force-dynamic";

const LEVELS: ActivityLevel[] = ["INFO", "WARN", "ERROR"];

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 150;
  }

  return Math.min(parsed, 500);
}

function parseLevel(raw: string | null): ActivityLevel | "ALL" {
  if (!raw) {
    return "ALL";
  }

  const normalized = raw.trim().toUpperCase();
  if (LEVELS.includes(normalized as ActivityLevel)) {
    return normalized as ActivityLevel;
  }

  return "ALL";
}

export async function GET(request: NextRequest) {
  const currentUser = await getApiAuthenticatedUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (currentUser.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await seedSystemActivityIfEmpty();

  const params = request.nextUrl.searchParams;
  const limit = parseLimit(params.get("limit"));
  const level = parseLevel(params.get("level"));
  const search = params.get("search")?.trim() || "";

  const logs = await listActivityLogs({
    limit,
    level,
    search,
  });

  return NextResponse.json({ logs });
}
