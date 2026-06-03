import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
	checkRateLimit,
	createRateLimitExceededResponse,
	withRateLimitHeaders,
} from "@/lib/auth/rateLimit";
import { createCsrfBlockedResponse, hasValidSameOrigin } from "@/lib/auth/security";
import {
	isAuthMailerConfigured,
	sendPasswordResetEmail,
} from "@/lib/auth/mailer";
import { logActivitySafe } from "@/lib/activity/store";
import { createPasswordResetToken } from "@/lib/auth/passwordReset";
import { findUserByEmail } from "@/lib/auth/store";
import { validateEmail } from "@/lib/auth/validation";

function resolveAppOrigin(request: NextRequest): string {
	const configuredOrigin =
		process.env.AUTH_APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();

	if (configuredOrigin) {
		return configuredOrigin.replace(/\/$/, "");
	}

	return request.nextUrl.origin;
}

function hasValidGmailAppPasswordFormat(): boolean {
	const smtpHost =
		process.env.AUTH_SMTP_HOST?.trim().toLowerCase() || "smtp.gmail.com";
	const smtpUser = process.env.AUTH_SMTP_USER?.trim().toLowerCase() || "";
	const smtpPass = process.env.AUTH_SMTP_PASS?.replace(/\s+/g, "").trim() || "";

	const isGmailSmtp =
		smtpHost === "smtp.gmail.com" || smtpUser.endsWith("@gmail.com");
	if (!isGmailSmtp) {
		return true;
	}

	return smtpPass.length === 16;
}

const FORGOT_PASSWORD_RATE_LIMIT = { windowMs: 60_000, max: 5 };

export async function POST(request: NextRequest) {
	if (!hasValidSameOrigin(request)) {
		await logActivitySafe({
			level: "WARN",
			module: "AUTH",
			action: "FORGOT_PASSWORD_CSRF_BLOCKED",
			detail: "Permintaan lupa password ditolak karena validasi origin gagal.",
			actorRole: "guest",
			request,
		});
		return createCsrfBlockedResponse();
	}

	const rateLimit = checkRateLimit(
		request,
		"auth:forgot-password",
		FORGOT_PASSWORD_RATE_LIMIT,
	);
	if (!rateLimit.allowed) {
		await logActivitySafe({
			level: "WARN",
			module: "AUTH",
			action: "FORGOT_PASSWORD_RATE_LIMITED",
			detail: "Permintaan lupa password melebihi batas rate limit.",
			actorRole: "guest",
			request,
		});
		return createRateLimitExceededResponse(rateLimit);
	}

	const respond = (body: unknown, status = 200) =>
		withRateLimitHeaders(NextResponse.json(body, { status }), rateLimit);

	try {
		const body = await request.json();
		const email = String(body?.email ?? "")
			.trim()
			.toLowerCase();

		if (!validateEmail(email)) {
			await logActivitySafe({
				level: "WARN",
				module: "AUTH",
				action: "FORGOT_PASSWORD_INVALID_EMAIL",
				detail: "Permintaan lupa password ditolak karena format email tidak valid.",
				actorName: email || "unknown",
				actorRole: "guest",
				request,
			});
			return respond(
				{ error: "Format email tidak valid." },
				400,
			);
		}

		if (!isAuthMailerConfigured()) {
			await logActivitySafe({
				level: "WARN",
				module: "AUTH",
				action: "FORGOT_PASSWORD_MAILER_NOT_CONFIGURED",
				detail: "Permintaan lupa password gagal karena konfigurasi SMTP belum lengkap.",
				actorName: email,
				actorRole: "guest",
				request,
			});
			return respond(
				{
					error:
						"Layanan email belum dikonfigurasi. Isi AUTH_SMTP_USER dan AUTH_SMTP_PASS di ui/.env.local, lalu restart server UI.",
				},
				503,
			);
		}

		if (!hasValidGmailAppPasswordFormat()) {
			await logActivitySafe({
				level: "WARN",
				module: "AUTH",
				action: "FORGOT_PASSWORD_INVALID_SMTP_PASSWORD",
				detail: "Permintaan lupa password gagal karena format AUTH_SMTP_PASS tidak valid.",
				actorName: email,
				actorRole: "guest",
				request,
			});
			return respond(
				{
					error:
						"AUTH_SMTP_PASS harus Gmail App Password 16 karakter (bukan password login Gmail biasa).",
				},
				400,
			);
		}

		const user = await findUserByEmail(email);
		if (!user) {
			await logActivitySafe({
				module: "AUTH",
				action: "FORGOT_PASSWORD_UNKNOWN_EMAIL",
				detail: "Permintaan reset password diterima untuk email yang tidak terdaftar.",
				actorName: email,
				actorRole: "guest",
				request,
			});
			return respond({
				success: true,
				message: "Jika email terdaftar, link reset password sudah dikirim.",
			});
		}

		const token = await createPasswordResetToken(user.id);
		const resetUrl = new URL("/reset-password", resolveAppOrigin(request));
		resetUrl.searchParams.set("token", token);

		await sendPasswordResetEmail({
			recipientEmail: user.email,
			recipientName: user.name,
			resetUrl: resetUrl.toString(),
		});

		await logActivitySafe({
			module: "AUTH",
			action: "FORGOT_PASSWORD_EMAIL_SENT",
			detail: "Link reset password berhasil dikirim ke email pengguna.",
			user: { id: user.id, name: user.name, role: user.role },
			request,
		});

		return respond({
			success: true,
			message: "Jika email terdaftar, link reset password sudah dikirim.",
		});
	} catch (error) {
		console.error("[Auth] forgot-password error:", error);

		const typedError = error as {
			code?: string;
			responseCode?: number;
			response?: string;
		};

		if (
			typedError.code === "EAUTH" ||
			typedError.responseCode === 535 ||
			/BadCredentials|Username and Password not accepted/i.test(
				typedError.response || "",
			)
		) {
			await logActivitySafe({
				level: "ERROR",
				module: "AUTH",
				action: "FORGOT_PASSWORD_SMTP_AUTH_ERROR",
				detail: "Gagal mengirim email reset password karena autentikasi SMTP ditolak.",
				actorRole: "guest",
				request,
			});
			return respond(
				{
					error:
						"Login SMTP ditolak oleh Gmail. Gunakan Gmail App Password 16 karakter pada AUTH_SMTP_PASS.",
				},
				400,
			);
		}

		await logActivitySafe({
			level: "ERROR",
			module: "AUTH",
			action: "FORGOT_PASSWORD_ERROR",
			detail: "Terjadi kesalahan internal saat memproses lupa password.",
			actorRole: "guest",
			request,
		});

		return respond(
			{ error: "Terjadi kesalahan saat memproses lupa password." },
			500,
		);
	}
}
