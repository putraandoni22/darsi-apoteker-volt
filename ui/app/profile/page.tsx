import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { requireAuthenticatedPageUser } from "@/lib/auth/guards";
import { getDashboardPathForRole } from "@/lib/auth/routing";

export default async function ProfilePage() {
	const user = await requireAuthenticatedPageUser();
	const dashboardPath = getDashboardPathForRole(user.role);

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-10">
			<div className="flex items-center justify-between gap-2">
				<h1 className="font-semibold text-2xl">Profil Pengguna</h1>
				<Button asChild variant="outline">
					<Link href={dashboardPath}>Kembali ke Dashboard</Link>
				</Button>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Informasi Akun</CardTitle>
					<CardDescription>
						Data ini diambil dari sesi login aktif.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<div>
						<p className="text-muted-foreground text-sm">Nama</p>
						<p className="font-medium">{user.name}</p>
					</div>
					<div>
						<p className="text-muted-foreground text-sm">Email</p>
						<p className="font-medium">{user.email}</p>
					</div>
					<div>
						<p className="text-muted-foreground text-sm">Role</p>
						<p className="font-medium capitalize">{user.role}</p>
					</div>
					{user.role === "pasien" ? (
						<div>
							<p className="text-muted-foreground text-sm">Nomor RM</p>
							<p className="font-medium">{user.nomorRM ?? "Belum tersedia"}</p>
						</div>
					) : null}
					<div>
						<p className="text-muted-foreground text-sm">Dibuat pada</p>
						<p className="font-medium">
							{new Date(user.createdAt).toLocaleString("id-ID")}
						</p>
					</div>
				</CardContent>
			</Card>
		</main>
	);
}
