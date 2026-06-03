import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Button } from "@/components/ui/button";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token || "";

  if (!token) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-4 py-10">
        <p className="text-center text-muted-foreground">
          Token reset tidak ditemukan atau sudah tidak valid.
        </p>
        <Button asChild>
          <Link href="/forgot-password">Buat Link Reset Baru</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md items-center px-4 py-10">
      <ResetPasswordForm token={token} />
    </main>
  );
}
