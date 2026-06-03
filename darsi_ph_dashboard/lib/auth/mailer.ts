import nodemailer from "nodemailer";

type MailerEnv = {
	smtpUser: string;
	smtpPass: string;
	smtpFrom: string;
};

interface PasswordResetEmailInput {
	recipientEmail: string;
	recipientName: string;
	resetUrl: string;
}

let cachedTransporter: nodemailer.Transporter | null = null;

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

function getMailerEnv(): MailerEnv | null {
	const smtpUser = process.env.AUTH_SMTP_USER?.trim();
	const smtpPass = process.env.AUTH_SMTP_PASS?.replace(/\s+/g, "").trim();
	const smtpFrom = process.env.AUTH_SMTP_FROM?.trim() || smtpUser;

	if (!smtpUser || !smtpPass || !smtpFrom) {
		return null;
	}

	return {
		smtpUser,
		smtpPass,
		smtpFrom,
	};
}

export function isAuthMailerConfigured(): boolean {
	return Boolean(getMailerEnv());
}

function getMailerTransport(): nodemailer.Transporter {
	const env = getMailerEnv();
	if (!env) {
		throw new Error("AUTH_SMTP_* belum dikonfigurasi.");
	}

	if (cachedTransporter) {
		return cachedTransporter;
	}

	const smtpHost = process.env.AUTH_SMTP_HOST?.trim() || "smtp.gmail.com";
	const smtpPort = Number(process.env.AUTH_SMTP_PORT?.trim() || "465");
	const smtpSecureRaw = process.env.AUTH_SMTP_SECURE?.trim().toLowerCase();
	const smtpSecure = smtpSecureRaw
		? ["1", "true", "yes"].includes(smtpSecureRaw)
		: smtpPort === 465;

	cachedTransporter = nodemailer.createTransport({
		host: smtpHost,
		port: smtpPort,
		secure: smtpSecure,
		auth: {
			user: env.smtpUser,
			pass: env.smtpPass,
		},
	});

	return cachedTransporter;
}

export async function sendPasswordResetEmail(
	input: PasswordResetEmailInput,
): Promise<void> {
	const env = getMailerEnv();
	if (!env) {
		throw new Error("AUTH_SMTP_* belum dikonfigurasi.");
	}

	const appName = process.env.AUTH_MAIL_APP_NAME?.trim() || "DARSI Apoteker";
	const recipientName = input.recipientName.trim() || "Pengguna";
	const safeName = escapeHtml(recipientName);
	const safeUrl = escapeHtml(input.resetUrl);

	const subject = `${appName} - Reset Password`;

	const textBody = [
		`Halo ${recipientName},`,
		"",
		`Kami menerima permintaan reset password untuk akun ${appName} Anda.`,
		"",
		"Klik tautan berikut untuk membuat password baru:",
		input.resetUrl,
		"",
		"Tautan ini berlaku selama 30 menit.",
		"",
		"Jika Anda tidak meminta reset password, silakan abaikan email ini.",
	].join("\n");

	const htmlBody = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <p>Halo ${safeName},</p>
      <p>Kami menerima permintaan reset password untuk akun <strong>${escapeHtml(appName)}</strong> Anda.</p>
      <p>Silakan klik tautan berikut untuk membuat password baru:</p>
      <p><a href="${safeUrl}">${safeUrl}</a></p>
      <p>Tautan ini berlaku selama <strong>30 menit</strong>.</p>
      <p>Jika Anda tidak meminta reset password, silakan abaikan email ini.</p>
    </div>
  `;

	const transport = getMailerTransport();
	await transport.sendMail({
		from: env.smtpFrom,
		to: input.recipientEmail,
		subject,
		text: textBody,
		html: htmlBody,
	});
}
