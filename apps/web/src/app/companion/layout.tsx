import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { CompanionNavigation } from '@/features/companion/companion-navigation';

export default async function CompanionLayout({ children, chat }: { children: React.ReactNode; chat: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.onboardingCompleted === false) redirect('/choose-identity');
  return <CompanionNavigation key={user.id} chat={chat}>{children}</CompanionNavigation>;
}
