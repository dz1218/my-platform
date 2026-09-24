import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { CompanionHome } from '@/features/companion/companion-home';
export default async function CompanionPage() {
  if (!await getCurrentUser()) redirect('/login');
  return <CompanionHome />;
}
