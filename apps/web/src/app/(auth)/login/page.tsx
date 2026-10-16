import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthForm } from "@/features/auth/auth-form";
export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.onboardingCompleted === false ? "/choose-identity" : "/companion");
  return <AuthForm />;
}
