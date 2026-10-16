import { getCurrentUser } from '@/lib/auth';
import { CompanionNavigation } from '@/features/companion/companion-navigation';

export default async function CompanionLayout({ children, chat }: { children: React.ReactNode; chat: React.ReactNode }) {
  const user = await getCurrentUser();
  return <CompanionNavigation key={user?.id ?? 'guest'} chat={chat}>{children}</CompanionNavigation>;
}
