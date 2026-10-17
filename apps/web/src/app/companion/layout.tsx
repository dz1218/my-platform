import { CompanionChatRoute } from '@/features/companion/companion-navigation';

export default function CompanionLayout({ children, chat }: { children: React.ReactNode; chat: React.ReactNode }) {
  return <CompanionChatRoute chat={chat}>{children}</CompanionChatRoute>;
}
