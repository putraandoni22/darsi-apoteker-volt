import { requireAuthenticatedPageUser, requireRoleForPage } from "@/lib/auth/guards";

export default async function ApotekerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuthenticatedPageUser();
  requireRoleForPage(user, ["admin", "apoteker"]);

  return <>{children}</>;
}
