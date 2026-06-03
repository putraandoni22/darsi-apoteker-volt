import { requireAuthenticatedPageUser, requireRoleForPage } from "@/lib/auth/guards";

export default async function PasienLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuthenticatedPageUser();
  requireRoleForPage(user, ["pasien"]);

  return <>{children}</>;
}
