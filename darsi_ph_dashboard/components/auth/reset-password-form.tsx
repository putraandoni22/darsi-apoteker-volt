"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (password !== confirmPassword) {
      setErrorMessage("Konfirmasi password tidak sama.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ token, password }),
      });

      const data = await response.json();
      if (!response.ok) {
        setErrorMessage(data?.error || "Gagal reset password.");
        return;
      }

      setSuccessMessage("Password berhasil diubah. Anda akan diarahkan ke login.");
      setTimeout(() => {
        router.push("/signin");
      }, 1200);
    } catch {
      setErrorMessage("Tidak bisa terhubung ke server.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full border-border/60 shadow-md">
      <CardHeader className="space-y-2">
        <CardTitle className="text-2xl">Reset Password</CardTitle>
        <CardDescription>Masukkan password baru untuk akun Anda.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="password" className="font-medium text-sm">
              Password Baru
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Minimal 8 karakter"
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="confirm-password" className="font-medium text-sm">
              Konfirmasi Password
            </label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Ulangi password"
              required
            />
          </div>

          {errorMessage ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
              {errorMessage}
            </p>
          ) : null}

          {successMessage ? (
            <p className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-emerald-700 text-sm dark:text-emerald-300">
              {successMessage}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Memproses..." : "Simpan Password Baru"}
          </Button>

          <p className="text-center text-muted-foreground text-sm">
            Kembali ke{" "}
            <Link href="/signin" className="font-medium text-primary hover:underline">
              halaman login
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
