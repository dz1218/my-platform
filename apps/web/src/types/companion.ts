export type User = { id: string; name: string; email: string };
export type Identity = { id: string; name: string; age: number; avatarUrl: string };
export type Match = { id: string; conversationId: string; identity: Identity };
export type Message = {
  id: string; sender: { id: string; name: string }; senderType: 'user' | 'identity';
  content: string; status: 'pending' | 'complete' | 'failed'; requestId?: string; createdAt: string;
};
export type MessagePage = { items: Message[]; nextCursor?: string };
