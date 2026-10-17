import type { QueryClient } from '@tanstack/query-core';
import { createDomainStore } from '../create-store';
import type { AutoReply, Message, MessagePage } from '@my-platform/shared';

export type Turn = { content: string; requestId: string };
export type ConversationDependencies = {
  createRequestId: () => string;
  client: QueryClient;
  conversationId: string;
  send: (content: string, requestId: string) => Promise<{ message: Message }>;
};
export type ConversationStore = {
  connectionError: Error | null;
  sendError: Error | null;
  outgoing: Turn | null;
  failedTurn: Turn | null;
  setConnectionError: (error: Error | null) => void;
  completeTurn: () => void;
  failTurn: (turn: Turn) => void;
  prepareTurn: (content: string, requestId?: string) => Turn;
  send: (content: string, requestId?: string) => Promise<{ message: Message }>;
  receivePage: (page: MessagePage) => void;
  receiveSettings: (settings: AutoReply) => void;
};

export const conversationSelectors = {
  error: (s: ConversationStore) => s.sendError ?? s.connectionError,
  outgoing: (s: ConversationStore) => s.outgoing,
  sending: (s: ConversationStore) => s.outgoing !== null,
};
export function mergeConversationMessages(pages: MessagePage[], latest?: MessagePage) {
  const messages = new Map<string, Message>();
  for (const page of pages) for (const message of page.items) messages.set(message.id, message);
  for (const message of latest?.items ?? []) messages.set(message.id, message);
  return [...messages.values()].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
}

export function createConversationStore({ client, conversationId, send, createRequestId }: ConversationDependencies) {
  const key = ['messages', conversationId];
  return createDomainStore<ConversationStore>()((set, get) => ({
    connectionError: null, sendError: null, outgoing: null, failedTurn: null,
    setConnectionError: connectionError => set({ connectionError }),
    completeTurn: () => set({ failedTurn: null }),
    failTurn: failedTurn => set({ failedTurn }),
    prepareTurn: (content, requestId) => {
      const failed = get().failedTurn;
      return requestId ? { content, requestId } : failed?.content === content ? failed : { content, requestId: createRequestId() };
    },
    receivePage: page => {
      void client.cancelQueries({ queryKey: key, exact: true });
      client.setQueryData<MessagePage>(key, current => ({
        ...current, ...page, nextCursor: page.nextCursor ?? current?.nextCursor,
        items: mergeConversationMessages(current ? [current] : [], page),
      }));
      void client.invalidateQueries({ queryKey: ['matches'] });
    },
    receiveSettings: settings => {
      const queryKey = ['auto-reply', conversationId];
      void client.cancelQueries({ queryKey, exact: true });
      client.setQueryData<AutoReply>(queryKey, current => current && current.version > settings.version ? current : settings);
    },
    send: async (content, requestId) => {
      if (!content.trim() || content.length > 2000) throw new Error('请输入 1–2000 个字符的消息');
      if (get().outgoing) throw new Error('消息正在发送，请稍后再试');
      const turn = get().prepareTurn(content, requestId);
      set({ outgoing: turn, sendError: null });
      try {
        const result = await send(turn.content, turn.requestId);
        get().completeTurn();
        void client.cancelQueries({ queryKey: key, exact: true });
        client.setQueryData<MessagePage>(key, page => ({
          items: [...(page?.items ?? []).filter(item => item.id !== result.message.id), result.message],
          nextCursor: page?.nextCursor, replyStatus: page?.replyStatus,
        }));
        void client.invalidateQueries({ queryKey: ['matches'] });
        return result;
      } catch (error) {
        get().failTurn(turn);
        set({ sendError: error instanceof Error ? error : new Error('消息发送失败') });
        throw error;
      } finally { set({ outgoing: null }); }
    },
  }));
}
