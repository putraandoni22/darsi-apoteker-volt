import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getDashboardPathForRole } from "@/lib/auth/routing";
import { getCurrentUserFromRequest } from "@/lib/auth/session";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ authenticated: false, dashboardPath: null }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user,
    dashboardPath: getDashboardPathForRole(user.role),
  });
}
