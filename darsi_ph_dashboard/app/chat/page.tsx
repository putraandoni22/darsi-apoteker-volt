import { redirect } from "next/navigation";
import { requireAuthenticatedPageUser } from "@/lib/auth/guards";

export default async function ChatPage() {
  const user = await requireAuthenticatedPageUser();

  if (user.role === "pasien") {
    redirect("/pasien/asisten-obat");
  }

  redirect("/apoteker/asisten-obat");
}
