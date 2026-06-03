"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PublicUser, UserRole } from "@/lib/auth/store";

interface UserManagementTableProps {
	initialUsers: PublicUser[];
	currentUserId: string;
}

interface AdminUserMutationApiResponse {
	error?: string;
	user?: PublicUser;
}

export function UserManagementTable({
	initialUsers,
	currentUserId,
}: UserManagementTableProps) {
	const [users, setUsers] = useState(initialUsers);
	const [roleDrafts, setRoleDrafts] = useState<Record<string, UserRole>>(() => {
		return initialUsers.reduce<Record<string, UserRole>>(
			(accumulator, user) => {
				accumulator[user.id] = user.role;
				return accumulator;
			},
			{},
		);
	});
	const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
	const [updatingRoleUserId, setUpdatingRoleUserId] = useState<string | null>(
		null,
	);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	const adminCount = users.filter((item) => item.role === "admin").length;

	const onDeleteUser = async (targetUser: PublicUser) => {
		const confirmed = window.confirm(
			`Yakin ingin menghapus user ${targetUser.email}?`,
		);
		if (!confirmed) {
			return;
		}

		setErrorMessage(null);
		setSuccessMessage(null);
		setDeletingUserId(targetUser.id);

		try {
			const response = await fetch("/api/admin/users", {
				method: "DELETE",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({ userId: targetUser.id }),
			});

			const data =
				((await response
					.json()
					.catch(() => null)) as AdminUserMutationApiResponse | null) ?? null;

			if (!response.ok) {
				setErrorMessage(data?.error || "Gagal menghapus user.");
				return;
			}

			setUsers((previousUsers) =>
				previousUsers.filter((item) => item.id !== targetUser.id),
			);
			setRoleDrafts((previousDrafts) => {
				const nextDrafts = { ...previousDrafts };
				delete nextDrafts[targetUser.id];
				return nextDrafts;
			});
			setSuccessMessage(`User ${targetUser.email} berhasil dihapus.`);
		} catch {
			setErrorMessage("Tidak bisa terhubung ke server.");
		} finally {
			setDeletingUserId(null);
		}
	};

	const onSaveRole = async (targetUser: PublicUser) => {
		const selectedRole = roleDrafts[targetUser.id];
		if (!selectedRole || selectedRole === targetUser.role) {
			return;
		}

		setErrorMessage(null);
		setSuccessMessage(null);
		setUpdatingRoleUserId(targetUser.id);

		try {
			const response = await fetch("/api/admin/users", {
				method: "PATCH",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({
					userId: targetUser.id,
					role: selectedRole,
				}),
			});

			const data =
				((await response
					.json()
					.catch(() => null)) as AdminUserMutationApiResponse | null) ?? null;

			if (!response.ok) {
				setErrorMessage(data?.error || "Gagal mengubah role user.");
				return;
			}

			const updatedUser = data?.user;

			setUsers((previousUsers) =>
				previousUsers.map((item) => {
					if (item.id !== targetUser.id) {
						return item;
					}

					if (updatedUser && updatedUser.id === item.id) {
						return updatedUser;
					}

					return {
						...item,
						role: selectedRole,
						nomorRM: selectedRole === "pasien" ? item.nomorRM : null,
					};
				}),
			);
			setRoleDrafts((previousDrafts) => ({
				...previousDrafts,
				[targetUser.id]: selectedRole,
			}));
			setSuccessMessage(
				`Role ${targetUser.email} berhasil diubah menjadi ${selectedRole}.`,
			);
		} catch {
			setErrorMessage("Tidak bisa terhubung ke server.");
		} finally {
			setUpdatingRoleUserId(null);
		}
	};

	return (
		<div className="space-y-3">
			{errorMessage ? (
				<p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
					{errorMessage}
				</p>
			) : null}

			{successMessage ? (
				<p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-600 text-sm">
					{successMessage}
				</p>
			) : null}

			<div className="overflow-x-auto rounded-md border">
				<table className="w-full text-left text-sm">
					<thead className="bg-muted/40">
						<tr>
							<th className="px-3 py-2">Nama</th>
							<th className="px-3 py-2">Email</th>
							<th className="px-3 py-2">Nomor RM</th>
							<th className="px-3 py-2">Role</th>
							<th className="px-3 py-2">Dibuat</th>
							<th className="px-3 py-2 text-right">Aksi</th>
						</tr>
					</thead>
					<tbody>
						{users.map((item) => {
							const isDeleting = deletingUserId === item.id;
							const isUpdatingRole = updatingRoleUserId === item.id;
							const isSelf = item.id === currentUserId;
							const isLastAdmin = item.role === "admin" && adminCount <= 1;
							const roleDraft = roleDrafts[item.id] ?? item.role;
							const isRoleChanged = roleDraft !== item.role;
							const isDemotingLastAdmin =
								item.role === "admin" &&
								adminCount <= 1 &&
								roleDraft !== "admin";

							const isDeleteDisabled =
								isDeleting || isUpdatingRole || isSelf || isLastAdmin;
							const isSaveRoleDisabled =
								isUpdatingRole ||
								isDeleting ||
								isSelf ||
								!isRoleChanged ||
								isDemotingLastAdmin;

							const deleteDisabledReason = isSelf
								? "Akun yang sedang login tidak bisa dihapus."
								: isLastAdmin
									? "Admin terakhir tidak boleh dihapus."
									: undefined;

							const saveRoleDisabledReason = isSelf
								? "Akun yang sedang login tidak bisa mengubah role sendiri."
								: isDemotingLastAdmin
									? "Admin terakhir tidak boleh diturunkan rolenya."
									: undefined;

							return (
								<tr key={item.id} className="border-t">
									<td className="px-3 py-2">{item.name}</td>
									<td className="px-3 py-2">{item.email}</td>
									<td className="px-3 py-2 font-mono text-xs">
										{item.role === "pasien"
											? (item.nomorRM ?? "Belum tersedia")
											: "-"}
									</td>
									<td className="px-3 py-2">
										<div className="flex items-center justify-end gap-2 md:justify-start">
											<select
												className="h-8 rounded-md border bg-background px-2 text-xs capitalize"
												disabled={isUpdatingRole || isDeleting || isSelf}
												value={roleDraft}
												onChange={(event) => {
													const nextRole = event.target.value as UserRole;
													setRoleDrafts((previousDrafts) => ({
														...previousDrafts,
														[item.id]: nextRole,
													}));
												}}
											>
												<option value="admin">admin</option>
												<option value="apoteker">apoteker</option>
												<option value="pasien">pasien</option>
											</select>
											<Button
												type="button"
												variant="outline"
												size="sm"
												title={saveRoleDisabledReason}
												disabled={isSaveRoleDisabled}
												onClick={() => {
													void onSaveRole(item);
												}}
											>
												{isUpdatingRole ? "Menyimpan..." : "Simpan"}
											</Button>
										</div>
									</td>
									<td className="px-3 py-2">
										{new Date(item.createdAt).toLocaleString("id-ID", {
											timeZone: "Asia/Jakarta",
										})}
									</td>
									<td className="px-3 py-2 text-right">
										<Button
											type="button"
											variant="destructive"
											size="sm"
											title={deleteDisabledReason}
											disabled={isDeleteDisabled}
											onClick={() => {
												void onDeleteUser(item);
											}}
										>
											{isDeleting ? "Menghapus..." : "Hapus"}
										</Button>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>

			<p className="text-muted-foreground text-xs">
				Akun yang sedang login tidak bisa dihapus/diubah rolenya, dan admin
				terakhir tidak boleh dihapus atau diturunkan rolenya.
			</p>
		</div>
	);
}
