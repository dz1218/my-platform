import { CompanionNavigation } from '@/features/companion/companion-navigation';

export default function CompanionLayout({ children, chat }: { children: React.ReactNode; chat: React.ReactNode }) {
  return <CompanionNavigation chat={chat}>{children}</CompanionNavigation>;
}
