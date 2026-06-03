import { requireAuthenticatedPageUser, requireRoleForPage } from "@/lib/auth/guards";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuthenticatedPageUser();
  requireRoleForPage(user, ["admin"]);

  return <>{children}</>;
}
