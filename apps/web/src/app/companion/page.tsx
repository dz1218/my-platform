import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { CompanionHome } from "@/features/companion/companion-home";

export const dynamic = 'force-dynamic';

export default async function CompanionPage() {
  const user = await getCurrentUser();
  if (user?.onboardingCompleted === false) redirect('/choose-identity');
  return <CompanionHome accountId={user?.id ?? null} inheritedIdentity={user?.inheritedIdentity} />;
}
