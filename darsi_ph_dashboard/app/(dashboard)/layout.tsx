import { DashboardShell } from "@/components/layout/dashboard-shell";
import { requireAuthenticatedPageUser } from "@/lib/auth/guards";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuthenticatedPageUser();

  return <DashboardShell user={user}>{children}</DashboardShell>;
}
