"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { DarsiLogo } from "@/components/branding/darsi-logo";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getDashboardPathForRole } from "@/lib/auth/routing";
import type { UserRole } from "@/lib/auth/store";

function isUserRole(value: unknown): value is UserRole {
	return value === "admin" || value === "apoteker" || value === "pasien";
}

export function SignInForm() {
	const router = useRouter();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setErrorMessage(null);
		setIsSubmitting(true);

		try {
			const response = await fetch("/api/auth/login", {
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({ email, password }),
			});

			const data = await response.json();

			if (!response.ok) {
				setErrorMessage(data?.error || "Gagal masuk.");
				return;
			}

			const nextPath = isUserRole(data?.user?.role)
				? getDashboardPathForRole(data.user.role)
				: "/";

			router.push(nextPath);
			router.refresh();
		} catch {
			setErrorMessage("Tidak bisa terhubung ke server.");
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<Card className="w-full border-emerald-200/80 bg-white/95 shadow-[0_18px_32px_-24px_rgba(5,150,105,0.45)] dark:border-emerald-900/80 dark:bg-[#0a1510]/95">
			<CardHeader className="space-y-2">
				<DarsiLogo
					size={38}
					titleClassName="text-base"
					subtitleClassName="text-[10px] tracking-[0.1em] text-emerald-700/85 dark:text-emerald-300/85"
				/>
				<CardTitle className="text-2xl">Masuk ke DARSI Apoteker</CardTitle>
				<CardDescription>
					Login untuk mengakses sistem pencarian obat RSI.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={onSubmit} className="space-y-4">
					<div className="space-y-2">
						<label htmlFor="email" className="font-medium text-sm">
							Email
						</label>
						<Input
							id="email"
							type="email"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							placeholder="nama@rumahsakit.id"
							required
						/>
					</div>

					<div className="space-y-2">
						<label htmlFor="password" className="font-medium text-sm">
							Password
						</label>
						<Input
							id="password"
							type="password"
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							placeholder="Minimal 8 karakter"
							required
						/>
						<div className="text-right">
							<Link
								href="/forgot-password"
								className="text-muted-foreground text-xs hover:text-primary hover:underline"
							>
								Lupa password?
							</Link>
						</div>
					</div>

					{errorMessage ? (
						<p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
							{errorMessage}
						</p>
					) : null}

					<Button
						type="submit"
						className="w-full bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:from-emerald-400 hover:to-green-500"
						disabled={isSubmitting}
					>
						{isSubmitting ? "Memproses..." : "Masuk"}
					</Button>

					<p className="text-center text-muted-foreground text-sm">
						Belum punya akun?{" "}
						<Link
							href="/signup"
							className="font-medium text-emerald-700 hover:text-emerald-600 hover:underline dark:text-emerald-300 dark:hover:text-emerald-200"
						>
							Daftar di sini
						</Link>
					</p>
				</form>
			</CardContent>
		</Card>
	);
}
