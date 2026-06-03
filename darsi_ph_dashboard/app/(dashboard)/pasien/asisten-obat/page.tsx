import { Assistant } from "@/app/assistant";
import { requireAuthenticatedPageUser } from "@/lib/auth/guards";

export default async function PasienAssistantPage() {
  const user = await requireAuthenticatedPageUser();

  return (
    <div className="-mx-4 -my-4 h-[calc(100dvh-5rem)] md:-mx-6 md:-my-6">
      <Assistant user={user} embedded />
    </div>
  );
}