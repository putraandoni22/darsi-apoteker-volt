import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/signup-form";
import { getDashboardPathForRole } from "@/lib/auth/routing";
import { getCurrentUserFromCookies } from "@/lib/auth/session";

export default async function SignUpPage() {
  const user = await getCurrentUserFromCookies();
  if (user) {
    redirect(getDashboardPathForRole(user.role));
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md items-center bg-gradient-to-b from-emerald-50 via-[#f8fffb] to-white px-4 py-10 dark:from-[#030906] dark:via-[#07110c] dark:to-[#020604]">
      <SignUpForm />
    </main>
  );
}
