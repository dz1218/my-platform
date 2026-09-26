import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import { AuthForm } from '@/features/auth/auth-form';
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isAuthenticated()) redirect('/companion');
  return <AuthForm error={(await searchParams).error} />;
}
