import { api, check } from './api/client';
import type { Message, MessagePage } from '@/types/companion';
export const history = (id: string, before?: string) => api<MessagePage>(`/conversations/${encodeURIComponent(id)}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`);
export type ChatEvent = { event: 'accepted'; data: { id: string; requestId: string } } | { event: 'delta'; data: { content: string } } | { event: 'done'; data: { message: Message } } | { event: 'error'; data: { message: string } };

// POST + SSE: parsing survives UTF-8 splits, CRLF and multiple frames per chunk.
export async function streamMessage(id: string, content: string, requestId: string, signal: AbortSignal, onEvent: (event: ChatEvent) => void) {
  const response = await check(await fetch(`/api/v1/conversations/${encodeURIComponent(id)}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, requestId }), signal,
  }));
  if (!response.body) throw new Error('连接中断，请稍后重试');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', done = false;
  const consume = () => {
    let boundary: RegExpExecArray | null;
    while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      const lines = frame.split(/\r?\n/);
      const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
      const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!event || !data) continue;
      const parsed = JSON.parse(data);
      if (event === 'error') throw new Error(parsed.message ?? '暂时没有收到回复');
      if (event === 'done') done = true;
      onEvent({ event, data: parsed } as ChatEvent);
    }
  };
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      consume();
      if (chunk.done) break;
    }
    if (!done) throw new Error('连接中断，请稍后重试这条消息');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
