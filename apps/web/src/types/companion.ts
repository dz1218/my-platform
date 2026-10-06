export type Gender = 'FEMALE' | 'MALE';
export type User = {
  id: string; name: string; email: string; gender: Gender | null;
  onboardingCompleted: boolean; inheritedIdentity: Identity | null;
};
export type Identity = { id: string; name: string; age: number; avatarUrl: string; gender?: Gender; city?: string; background?: string; occupationCode?: string; occupation?: string };
export type InheritanceState = {
  gender: Gender | null; onboardingCompleted: boolean; identity: Identity | null;
  items: Array<Identity & { available: boolean }>;
  selected?: (Identity & { available: boolean }) | null;
};
export type Match = { id: string; conversationId: string; identity: Identity };
export type Message = {
  id: string; sender: { id: string; name: string }; senderType: 'user' | 'identity';
  source?: 'USER' | 'AI' | 'HUMAN'; content: string; status: 'pending' | 'complete' | 'failed'; requestId?: string; createdAt: string;
};
export type MessagePage = { items: Message[]; nextCursor?: string; replyStatus?: 'idle' | 'queued' | 'generating' | 'scheduled' | 'delivered' | 'failed' | 'cancelled' };

export type AutoReply = {
  ownerType: 'AI' | 'HUMAN'; mode: 'NEVER' | 'TIMEOUT' | 'ALWAYS';
  delaySeconds: number; version: number; canManage: boolean;
};
