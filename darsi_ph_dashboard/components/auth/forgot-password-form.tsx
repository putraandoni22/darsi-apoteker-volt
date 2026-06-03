"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function ForgotPasswordForm() {
	const [email, setEmail] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setErrorMessage(null);
		setSuccessMessage(null);
		setIsSubmitting(true);

		try {
			const response = await fetch("/api/auth/forgot-password", {
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({ email }),
			});

			const data = await response.json();
			if (!response.ok) {
				setErrorMessage(data?.error || "Gagal memproses lupa password.");
				return;
			}

			setSuccessMessage(data?.message || "Silakan cek email Anda.");
		} catch {
			setErrorMessage("Tidak bisa terhubung ke server.");
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<Card className="w-full border-border/60 shadow-md">
			<CardHeader className="space-y-2">
				<CardTitle className="text-2xl">Lupa Password</CardTitle>
				<CardDescription>
					Masukkan email akun. Link reset password akan dikirim ke email Anda.
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
						{isSubmitting ? "Memproses..." : "Kirim Link Reset"}
					</Button>

					<p className="text-center text-muted-foreground text-sm">
						Kembali ke{" "}
						<Link
							href="/signin"
							className="font-medium text-primary hover:underline"
						>
							halaman login
						</Link>
					</p>
				</form>
			</CardContent>
		</Card>
	);
}
