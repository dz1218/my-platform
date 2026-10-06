import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { IdentityOnboarding } from '@/features/identity/identity-onboarding';

export default async function ChooseIdentityPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <IdentityOnboarding accountId={user.id} accountName={user.name} />;
}
