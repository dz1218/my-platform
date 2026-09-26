import { api } from './api/client';
import type { Message, MessagePage } from '@/types/companion';
export const history = (id: string, before?: string, signal?: AbortSignal) => api<MessagePage>(`/conversations/${encodeURIComponent(id)}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`, { signal });

type Pending = { resolve: (value: { message: Message }) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
export class ChatConnection {
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private attempts = 0;
  private pending = new Map<string, Pending>();
  constructor(private id: string, private onHistory: (page: MessagePage) => void, private onError: (error: Error | null) => void) { this.connect(); }
  private connect() {
    if (this.stopped) return;
    const url = new URL(`/ws/conversations/${encodeURIComponent(this.id)}`, window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = this.socket = new WebSocket(url);
    socket.onopen = () => { this.attempts = 0; this.onError(null); };
    socket.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ping') { socket.send(JSON.stringify({ type: 'pong' })); return; }
        if (data.type === 'history') { this.onHistory(data.page); return; }
        const pending = this.pending.get(data.requestId);
        if (!pending) return;
        if (data.type !== 'accepted' && data.type !== 'error') return;
        clearTimeout(pending.timer); this.pending.delete(data.requestId);
        if (data.type === 'accepted') pending.resolve({ message: data.message });
        else pending.reject(new Error(data.message));
      } catch { socket.close(); }
    };
    socket.onclose = () => {
      this.rejectPending();
      if (this.stopped) return;
      this.onError(new Error('聊天连接已断开，正在重连…'));
      this.retry = setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.attempts++, 15000));
    };
    socket.onerror = () => socket.close();
  }
  send(content: string, requestId: string): Promise<{ message: Message }> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('聊天正在连接，请稍后重试'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('发送确认超时，请重试')); }, 15000);
      this.pending.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({ type: 'send', content, requestId }));
    });
  }
  private rejectPending() {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('连接中断，请重试发送')); }
    this.pending.clear();
  }
  close() { this.stopped = true; clearTimeout(this.retry); this.socket?.close(); this.rejectPending(); }
}
