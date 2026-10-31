import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthForm } from "@/features/auth/auth-form";
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ password?: string }> }) {
  const user = await getCurrentUser();
  if (user) redirect("/");
  return <AuthForm passwordUpdated={(await searchParams).password === "updated"} />;
}
