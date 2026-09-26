import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import { AuthForm } from '@/features/auth/auth-form';
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isAuthenticated()) redirect('/companion');
  return <AuthForm register error={(await searchParams).error} />;
}
