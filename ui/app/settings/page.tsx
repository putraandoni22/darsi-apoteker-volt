import Link from "next/link";
import { UserManagementTable } from "@/components/auth/user-management-table";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	requireAuthenticatedPageUser,
	requireRoleForPage,
} from "@/lib/auth/guards";
import { listPublicUsers } from "@/lib/auth/store";

export default async function SettingsPage() {
	const user = await requireAuthenticatedPageUser();
	requireRoleForPage(user, ["admin"]);

	const users = await listPublicUsers();

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 px-4 py-10">
			<div className="flex items-center justify-between gap-2">
				<h1 className="font-semibold text-2xl">Settings Admin</h1>
				<Button asChild variant="outline">
					<Link href="/admin">Kembali ke Dashboard Admin</Link>
				</Button>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Manajemen Pengguna</CardTitle>
					<CardDescription>
						Halaman ini hanya bisa diakses role admin.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<UserManagementTable initialUsers={users} currentUserId={user.id} />
				</CardContent>
			</Card>
		</main>
	);
}
