import { privateSocketURL } from './socket-url';
import { api } from "./api/client";
import type { AutoReply, Message, MessagePage } from "@/types/companion";
export const history = (id: string, before?: string, signal?: AbortSignal) =>
  api<MessagePage>(
    `/conversations/${encodeURIComponent(id)}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`,
    { signal },
  );

type Pending = {
  resolve: (value: { message: Message }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
export class ChatConnection {
  private socket?: WebSocket;
  private connecting?: AbortController;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private retry?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private cursor = "0";
  private lastTyping = 0;
  private attempts = 0;
  private pending = new Map<string, Pending>();
  constructor(
    private id: string,
    private onHistory: (page: MessagePage) => void,
    private onError: (error: Error | null) => void,
    private onSettings?: (settings: AutoReply) => void,
  ) {
    this.connect();
  }
  private async connect() {
    if (this.stopped) return;
    const pending = new AbortController();
    this.connecting = pending;
    let socket: WebSocket;
    try {
      const url = await privateSocketURL('conversation', AbortSignal.any([pending.signal, AbortSignal.timeout(10_000)]), this.id);
      if (this.stopped || this.connecting !== pending) return;
      if (this.cursor !== '0') url.searchParams.set('after', this.cursor);
      socket = new WebSocket(url);
    } catch {
      if (!this.stopped && this.connecting === pending) {
        this.connecting = undefined;
        this.scheduleRetry();
      }
      return;
    }
    this.connecting = undefined;
    this.socket = socket;
    this.connectTimer = setTimeout(() => socket.close(), 10_000);
    socket.onopen = () => {
      if (this.stopped || this.socket !== socket) return;
      clearTimeout(this.connectTimer);
      this.attempts = 0;
      this.onError(null);
    };
    socket.onmessage = (event) => {
      if (this.stopped || this.socket !== socket) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "ping") {
          socket.send(JSON.stringify({ type: "pong" }));
          return;
        }
        if (data.type === "auto_reply.settings_updated") {
          this.onSettings?.(data.settings);
          return;
        }
        if (data.type === "history") {
          for (const m of data.page.items as Message[])
            if (BigInt(m.id) > BigInt(this.cursor)) this.cursor = m.id;
          for (const message of data.page.items as Message[]) this.acknowledge(message);
          this.onHistory(data.page);
          return;
        }
        if (data.type === "message.created") {
          const m = data.message as Message;
          if (BigInt(m.id) > BigInt(this.cursor)) this.cursor = m.id;
          this.acknowledge(m);
          this.onHistory({ items: [m] });
          return;
        }
        const pending = this.pending.get(data.requestId);
        if (!pending) return;
        if (data.type !== "accepted" && data.type !== "error") return;
        clearTimeout(pending.timer);
        this.pending.delete(data.requestId);
        if (data.type === "accepted")
          pending.resolve({ message: data.message });
        else pending.reject(new Error(data.message));
      } catch {
        socket.close();
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      clearTimeout(this.connectTimer);
      this.socket = undefined;
      this.rejectPending();
      this.scheduleRetry();
    };
    socket.onerror = () => socket.close();
  }
  private acknowledge(message: Message) {
    if (!message.requestId) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    pending.resolve({ message });
  }
  private scheduleRetry() {
    if (this.stopped || this.retry) return;
    this.onError(new Error('聊天连接已断开，正在重连…'));
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.connect();
    }, Math.min(1000 * 2 ** Math.min(this.attempts++, 4), 15000));
  }
  typing() {
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      Date.now() - this.lastTyping > 2000
    ) {
      this.lastTyping = Date.now();
      this.socket.send(JSON.stringify({ type: "typing" }));
    }
  }
  send(content: string, requestId: string): Promise<{ message: Message }> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error("聊天正在连接，请稍后重试"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("发送确认超时，请重试"));
      }, 15000);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ type: "send", content, requestId }));
      } catch {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new Error("连接中断，请重试发送"));
      }
    });
  }
  private rejectPending() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("连接中断，请重试发送"));
    }
    this.pending.clear();
  }
  close() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearTimeout(this.connectTimer);
    this.connecting?.abort();
    this.connecting = undefined;
    this.socket?.close();
    this.socket = undefined;
    this.rejectPending();
  }
}

export const autoReply = (id: string, signal?: AbortSignal) =>
  api<AutoReply>(`/conversations/${encodeURIComponent(id)}/auto-reply`, {
    signal,
  });
export const configureAutoReply = (
  id: string,
  mode: AutoReply["mode"],
  delaySeconds: number,
) =>
  api<AutoReply>(`/conversations/${encodeURIComponent(id)}/auto-reply`, {
    method: "PATCH",
    body: JSON.stringify({ mode, delaySeconds }),
  });
export const takeover = (id: string, ownerType: AutoReply["ownerType"]) =>
  api<AutoReply>(`/conversations/${encodeURIComponent(id)}/takeover`, {
    method: "POST",
    body: JSON.stringify({ ownerType }),
  });
