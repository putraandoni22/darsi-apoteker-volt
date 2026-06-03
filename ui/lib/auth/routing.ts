import type { UserRole } from "@/lib/auth/store";

const DASHBOARD_PATH_BY_ROLE: Record<UserRole, string> = {
  admin: "/admin",
  apoteker: "/apoteker",
  pasien: "/pasien",
};

export function getDashboardPathForRole(role: UserRole): string {
  return DASHBOARD_PATH_BY_ROLE[role] ?? "/pasien";
}

export function getDefaultPathForUserRole(role?: UserRole | null): string {
  if (!role) {
    return "/";
  }

  return getDashboardPathForRole(role);
}
