import { getCurrentUser } from "@/lib/auth";
import { CompanionHome } from "@/features/companion/companion-home";

export const dynamic = 'force-dynamic';

export default async function CompanionPage() {
  const user = await getCurrentUser();
  return <CompanionHome accountId={user?.id ?? null} inheritedIdentity={user?.inheritedIdentity} />;
}
