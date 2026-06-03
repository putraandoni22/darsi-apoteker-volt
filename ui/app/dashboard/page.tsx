import { redirect } from "next/navigation";
import { requireAuthenticatedPageUser } from "@/lib/auth/guards";
import { getDashboardPathForRole } from "@/lib/auth/routing";

export default async function DashboardEntryPage() {
  const user = await requireAuthenticatedPageUser();
  redirect(getDashboardPathForRole(user.role));
}
