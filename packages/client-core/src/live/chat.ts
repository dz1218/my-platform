import { createDomainStore } from '../create-store';

export const liveChatTopic = 'live-chat.v1';
export const liveChatMaxLength = 500;
const maxMessages = 200;
type Author = { identity: string; name: string; assistant?: boolean };
export type LiveMessage = Author & { id: string; host: boolean; text: string; time: number; own: boolean };
export type LiveChatStore = {
  messages: LiveMessage[];
  draft: string;
  sending: boolean;
  error: string;
  unread: number;
  sessionVersion: number;
  setDraft: (draft: string) => void;
  mentionAssistant: () => void;
  markRead: () => void;
  receive: (message: LiveMessage, unread: boolean) => void;
  receivePayload: (payload: Uint8Array, author: Author, unread: boolean) => void;
  sendMessage: (author: Author, publish: (payload: Uint8Array) => Promise<void>) => Promise<boolean>;
  resetSession: () => void;
};
const initialState = () => ({ messages: [] as LiveMessage[], draft: '', sending: false, error: '', unread: 0 });

export const liveChatSelectors = {
  view: (s: LiveChatStore) => ({ messages: s.messages, draft: s.draft, sending: s.sending, error: s.error, unread: s.unread }),
};

export function createLiveChatStore({ createRequestId, codec, now = Date.now }: { createRequestId: () => string; codec: import('../contracts').LiveChatCodec; now?: () => number }) {
  // Per mounted room, bound both sender count and burst size. This protects
  // rendering only; LiveKit data-channel traffic still reaches the browser.
  const received = new Map<string, { count: number; until: number }>();
  const makeMessage = (author: Author, id: string, text: string, own: boolean): LiveMessage => ({
    ...author, id: `${author.identity}:${id}`, host: author.identity.startsWith('host_'), text, time: now(), own,
  });
  return createDomainStore<LiveChatStore>()((set, get) => ({
    ...initialState(), sessionVersion: 0,
    setDraft: draft => set({ draft }),
    mentionAssistant: () => set(s => /^@AI(?:\s|$)/i.test(s.draft) ? s : s.draft.length > liveChatMaxLength - 4 ? { error: '请为 @AI 预留 4 个字符。' } : { draft: `@AI ${s.draft}`, error: '' }),
    markRead: () => set({ unread: 0 }),
    receive: (message, unread) => set(s => s.messages.some(m => m.id === message.id) ? s : ({
      messages: [...s.messages, message].slice(-maxMessages), unread: s.unread + (unread ? 1 : 0),
    })),
    receivePayload: (payload, author, unread) => {
      if (payload.byteLength > 4096) return;
      const time = now();
      for (const [id, bucket] of received) if (bucket.until <= time) received.delete(id);
      let bucket = received.get(author.identity);
      if (!bucket) {
        if (received.size >= 200) return;
        bucket = { count: 0, until: time + 10_000 };
        received.set(author.identity, bucket);
      }
      try {
        const data: unknown = JSON.parse(codec.decode(payload));
        if (!data || typeof data !== 'object') return;
        const message = data as Record<string, unknown>;
        if (message.v !== 1 || typeof message.id !== 'string' || !message.id || message.id.length > 80 || typeof message.text !== 'string' || !message.text.trim() || message.text.length > liveChatMaxLength) return;
        // Readiness replay must not consume the sender's burst allowance.
        if (get().messages.some(item => item.id === `${author.identity}:${message.id}`)) return;
        if (++bucket.count > 20) return;
        get().receive(makeMessage(author, message.id, message.text.trim(), false), unread);
      } catch {
        // Ignore unrelated or malformed messages from other participants.
      }
    },
    sendMessage: async (author, publish) => {
      const { draft, sending, sessionVersion } = get();
      const text = draft.trim();
      if (sending || !text || text.length > liveChatMaxLength) return false;
      const id = createRequestId();
      set({ sending: true, error: '' });
      try {
        await publish(codec.encode(JSON.stringify({ v: 1, id, text })));
        if (get().sessionVersion !== sessionVersion) return false;
        const message = makeMessage(author, id, text, true);
        set(s => ({
          messages: [...s.messages.filter(item => item.id !== message.id), message].slice(-maxMessages),
          sending: false, unread: 0, draft: s.draft === draft ? '' : s.draft,
        }));
        return true;
      } catch {
        if (get().sessionVersion === sessionVersion) set({ sending: false, error: '消息未发送，请检查连接后重试。' });
        return false;
      }
    },
    resetSession: () => { received.clear(); set(s => ({ ...initialState(), sessionVersion: s.sessionVersion + 1 })); },
  }));
}
