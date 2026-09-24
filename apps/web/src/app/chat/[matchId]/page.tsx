import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { ChatRoom } from '@/features/chat/chat-room';
export default async function ChatPage({ params }: { params: Promise<{ matchId: string }> }) {
  if (!await getCurrentUser()) redirect('/login');
  const { matchId } = await params;
  return <ChatRoom key={matchId} matchId={matchId} />;
}
