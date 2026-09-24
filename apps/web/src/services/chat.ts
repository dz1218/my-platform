import { api } from './api/client';
import type { Message, MessagePage } from '@/types/companion';
export const history = (id: string, before?: string) => api<MessagePage>(`/conversations/${encodeURIComponent(id)}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`);
// 202 acknowledges durable receipt. The identity's reply arrives in history later.
export const sendMessage = (id: string, content: string, requestId: string) => api<{ message: Message }>(`/conversations/${encodeURIComponent(id)}/messages`, {
  method: 'POST', body: JSON.stringify({ content, requestId }), signal: AbortSignal.timeout(15_000),
});
