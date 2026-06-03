import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
	checkRateLimit,
	createRateLimitExceededResponse,
	withRateLimitHeaders,
} from "@/lib/auth/rateLimit";
import { createCsrfBlockedResponse, hasValidSameOrigin } from "@/lib/auth/security";
import { getApiAuthenticatedUser } from "@/lib/auth/guards";
import {
	deleteUserById,
	listPublicUsers,
	type UserRole,
	updateUserRoleById,
} from "@/lib/auth/store";
import { logActivitySafe } from "@/lib/activity/store";

const ALLOWED_ROLES: UserRole[] = ["admin", "apoteker", "pasien"];
const ADMIN_MUTATION_RATE_LIMIT = { windowMs: 60_000, max: 30 };

export async function GET(request: NextRequest) {
	const currentUser = await getApiAuthenticatedUser(request);
	if (!currentUser) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	if (currentUser.role !== "admin") {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const users = await listPublicUsers();
	return NextResponse.json({ users });
}

export async function DELETE(request: NextRequest) {
	if (!hasValidSameOrigin(request)) {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "DELETE_CSRF_BLOCKED",
			detail: "Permintaan hapus user ditolak karena validasi origin gagal.",
			actorRole: "guest",
			request,
		});
		return createCsrfBlockedResponse();
	}

	const rateLimit = checkRateLimit(
		request,
		"admin:users:delete",
		ADMIN_MUTATION_RATE_LIMIT,
	);
	if (!rateLimit.allowed) {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "DELETE_RATE_LIMITED",
			detail: "Permintaan hapus user melebihi batas rate limit.",
			actorRole: "guest",
			request,
		});
		return createRateLimitExceededResponse(rateLimit);
	}

	const respond = (body: unknown, status = 200) =>
		withRateLimitHeaders(NextResponse.json(body, { status }), rateLimit);

	const currentUser = await getApiAuthenticatedUser(request);
	if (!currentUser) {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "DELETE_UNAUTHORIZED",
			detail: "Permintaan hapus user ditolak karena belum login.",
			actorRole: "guest",
			request,
		});
		return respond({ error: "Unauthorized" }, 401);
	}

	if (currentUser.role !== "admin") {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "DELETE_FORBIDDEN",
			detail: "Permintaan hapus user ditolak karena role bukan admin.",
			user: {
				id: currentUser.id,
				name: currentUser.name,
				role: currentUser.role,
			},
			request,
		});
		return respond({ error: "Forbidden" }, 403);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "DELETE_INVALID_BODY",
			detail: "Permintaan hapus user gagal diparse karena request body tidak valid.",
			user: {
				id: currentUser.id,
				name: currentUser.name,
				role: currentUser.role,
			},
			request,
		});
		return respond(
			{ error: "Request body tidak valid." },
			400,
		);
	}

	if (!body || typeof body !== "object") {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "DELETE_INVALID_BODY",
			detail: "Permintaan hapus user ditolak karena request body bukan objek.",
			user: {
				id: currentUser.id,
				name: currentUser.name,
				role: currentUser.role,
			},
			request,
		});
		return respond(
			{ error: "Request body tidak valid." },
			400,
		);
	}

	const userId = (body as { userId?: unknown }).userId;
	if (typeof userId !== "string" || userId.trim().length === 0) {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "DELETE_INVALID_USER_ID",
			detail: "Permintaan hapus user ditolak karena userId kosong.",
			user: {
				id: currentUser.id,
				name: currentUser.name,
				role: currentUser.role,
			},
			request,
		});
		return respond({ error: "userId wajib diisi." }, 400);
	}

	const normalizedUserId = userId.trim();

	const result = await deleteUserById(normalizedUserId, {
		actorUserId: currentUser.id,
	});

	if (result.error === "USER_NOT_FOUND") {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "DELETE_USER_NOT_FOUND",
			detail: `Hapus user gagal karena user ${normalizedUserId} tidak ditemukan.`,
			user: {
				id: currentUser.id,
				name: currentUser.name,
				role: currentUser.role,
			},
			request,
		});
		return respond(
			{ error: "User tidak ditemukan." },
			404,
		);
	}

	if (result.error === "CANNOT_DELETE_SELF") {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "DELETE_SELF_BLOCKED",
			detail: "Hapus user ditolak karena admin mencoba menghapus akun sendiri.",
			user: {
				id: currentUser.id,
				name: currentUser.name,
				role: currentUser.role,
			},
			request,
		});
		return respond(
			{ error: "Akun yang sedang login tidak bisa dihapus." },
			400,
		);
	}

	if (result.error === "CANNOT_DELETE_LAST_ADMIN") {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "DELETE_LAST_ADMIN_BLOCKED",
			detail: "Hapus user ditolak karena target adalah admin terakhir.",
			user: {
				id: currentUser.id,
				name: currentUser.name,
				role: currentUser.role,
			},
			request,
		});
		return respond(
			{ error: "Admin terakhir tidak boleh dihapus." },
			400,
		);
	}

	await logActivitySafe({
		module: "ADMIN_USERS",
		action: "DELETE_SUCCESS",
		detail: `User ${result.user?.email || normalizedUserId} berhasil dihapus.`,
		user: {
			id: currentUser.id,
			name: currentUser.name,
			role: currentUser.role,
		},
		request,
	});

	return respond({ user: result.user });
}

export async function PATCH(request: NextRequest) {
	if (!hasValidSameOrigin(request)) {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "PATCH_CSRF_BLOCKED",
			detail: "Permintaan ubah role ditolak karena validasi origin gagal.",
			actorRole: "guest",
			request,
		});
		return createCsrfBlockedResponse();
	}

	const rateLimit = checkRateLimit(
		request,
		"admin:users:patch",
		ADMIN_MUTATION_RATE_LIMIT,
	);
	if (!rateLimit.allowed) {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "PATCH_RATE_LIMITED",
			detail: "Permintaan ubah role melebihi batas rate limit.",
			actorRole: "guest",
			request,
		});
		return createRateLimitExceededResponse(rateLimit);
	}

	const respond = (body: unknown, status = 200) =>
		withRateLimitHeaders(NextResponse.json(body, { status }), rateLimit);

	const currentUser = await getApiAuthenticatedUser(request);
	if (!currentUser) {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "PATCH_UNAUTHORIZED",
			detail: "Permintaan ubah role ditolak karena belum login.",
			actorRole: "guest",
			request,
		});
		return respond({ error: "Unauthorized" }, 401);
	}

	if (currentUser.role !== "admin") {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "PATCH_FORBIDDEN",
			detail: "Permintaan ubah role ditolak karena role bukan admin.",
			user: {
				id: currentUser.id,
				name: currentUser.name,
				role: currentUser.role,
			},
			request,
		});
		return respond({ error: "Forbidden" }, 403);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "PATCH_INVALID_BODY",
			detail: "Permintaan ubah role gagal diparse karena request body tidak valid.",
			user: {
				id: currentUser.id,
				name: currentUser.name,
				role: currentUser.role,
			},
			request,
		});
		return respond(
			{ error: "Request body tidak valid." },
			400,
		);
	}

	if (!body || typeof body !== "object") {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "PATCH_INVALID_BODY",
			detail: "Permintaan ubah role ditolak karena request body bukan objek.",
			user: {
				id: currentUser.id,
				name: currentUser.name,
				role: currentUser.role,
			},
			request,
		});
		return respond(
			{ error: "Request body tidak valid." },
			400,
		);
	}

	const userId = (body as { userId?: unknown }).userId;
	if (typeof userId !== "string" || userId.trim().length === 0) {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "PATCH_INVALID_USER_ID",
			detail: "Permintaan ubah role ditolak karena userId kosong.",
			user: {
				id: currentUser.id,
				name: currentUser.name,
				role: currentUser.role,
			},
			request,
		});
		return respond(
			{ error: "userId wajib diisi." },
			400,
		);
	}

	const normalizedUserId = userId.trim();

	const role = (body as { role?: unknown }).role;
	if (typeof role !== "string" || !ALLOWED_ROLES.includes(role as UserRole)) {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "PATCH_INVALID_ROLE",
			detail: "Permintaan ubah role ditolak karena role target tidak valid.",
			user: {
				id: currentUser.id,
				name: currentUser.name,
				role: currentUser.role,
			},
			request,
		});
		return respond(
			{ error: "Role tidak valid." },
			400,
		);
	}

	const normalizedRole = role as UserRole;

	const result = await updateUserRoleById(normalizedUserId, normalizedRole, {
		actorUserId: currentUser.id,
	});

	if (result.error === "USER_NOT_FOUND") {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "PATCH_USER_NOT_FOUND",
			detail: `Ubah role gagal karena user ${normalizedUserId} tidak ditemukan.`,
			user: {
				id: currentUser.id,
				name: currentUser.name,
				role: currentUser.role,
			},
			request,
		});
		return respond(
			{ error: "User tidak ditemukan." },
			404,
		);
	}

	if (result.error === "INVALID_ROLE") {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "PATCH_INVALID_ROLE",
			detail: "Ubah role gagal karena role target tidak valid.",
			user: {
				id: currentUser.id,
				name: currentUser.name,
				role: currentUser.role,
			},
			request,
		});
		return respond({ error: "Role tidak valid." }, 400);
	}

	if (result.error === "CANNOT_CHANGE_SELF_ROLE") {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "PATCH_SELF_BLOCKED",
			detail: "Ubah role ditolak karena admin mencoba mengubah role sendiri.",
			user: {
				id: currentUser.id,
				name: currentUser.name,
				role: currentUser.role,
			},
			request,
		});
		return respond(
			{ error: "Akun yang sedang login tidak bisa mengubah role sendiri." },
			400,
		);
	}

	if (result.error === "CANNOT_DEMOTE_LAST_ADMIN") {
		await logActivitySafe({
			level: "WARN",
			module: "ADMIN_USERS",
			action: "PATCH_LAST_ADMIN_BLOCKED",
			detail: "Ubah role ditolak karena target adalah admin terakhir.",
			user: {
				id: currentUser.id,
				name: currentUser.name,
				role: currentUser.role,
			},
			request,
		});
		return respond(
			{ error: "Admin terakhir tidak boleh diturunkan rolenya." },
			400,
		);
	}

	await logActivitySafe({
		module: "ADMIN_USERS",
		action: "PATCH_SUCCESS",
		detail: `Role user ${result.user?.email || normalizedUserId} diubah menjadi ${normalizedRole}.`,
		user: {
			id: currentUser.id,
			name: currentUser.name,
			role: currentUser.role,
		},
		request,
	});

	return respond({ user: result.user });
}
