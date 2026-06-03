import { UserManagementTable } from "@/components/auth/user-management-table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAuthenticatedPageUser, requireRoleForPage } from "@/lib/auth/guards";
import { listPublicUsers } from "@/lib/auth/store";

export default async function AdminUsersPage() {
  const user = await requireAuthenticatedPageUser();
  requireRoleForPage(user, ["admin"]);
  const users = await listPublicUsers();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">Manajemen Pengguna</h1>
        <p className="text-muted-foreground text-sm">
          Kelola role dan akun pengguna pada sistem DARSI.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daftar User</CardTitle>
          <CardDescription>
            Fitur delete dan update role sudah aktif dengan proteksi admin terakhir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UserManagementTable initialUsers={users} currentUserId={user.id} />
        </CardContent>
      </Card>
    </div>
  );
}
