import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { ChatRoom } from '@/features/chat/chat-room';

export default async function InterceptedChatPage({ params }: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { matchId } = await params;
  return <ChatRoom key={`${user.id}:${matchId}`} matchId={matchId} inheritedIdentityId={user.inheritedIdentity?.id} intercepted />;
}
