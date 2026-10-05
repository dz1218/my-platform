import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { CompanionHome } from "@/features/companion/companion-home";
export default async function CompanionPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.onboardingCompleted === false) redirect('/choose-identity');
  return <CompanionHome inheritedIdentity={user.inheritedIdentity} />;
}
