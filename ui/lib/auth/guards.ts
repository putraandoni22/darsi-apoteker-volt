import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { getDashboardPathForRole } from "@/lib/auth/routing";
import { getCurrentUserFromCookies, getCurrentUserFromRequest } from "@/lib/auth/session";
import type { PublicUser, UserRole } from "@/lib/auth/store";

export async function requireAuthenticatedPageUser(): Promise<PublicUser> {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    redirect("/signin");
  }

  return user;
}

export function requireRoleForPage(user: PublicUser, allowedRoles: UserRole[]): void {
  if (!allowedRoles.includes(user.role)) {
    redirect(getDashboardPathForRole(user.role));
  }
}

export async function getApiAuthenticatedUser(
  request: NextRequest,
): Promise<PublicUser | null> {
  return getCurrentUserFromRequest(request);
}
