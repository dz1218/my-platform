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
  outgoing: Turn[];
  failedTurns: Turn[];
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
  sending: (s: ConversationStore) => s.outgoing.length > 0,
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
    connectionError: null, sendError: null, outgoing: [], failedTurns: [], failedTurn: null,
    setConnectionError: connectionError => set({ connectionError }),
    completeTurn: () => set({ failedTurn: null, failedTurns: [] }),
    failTurn: failedTurn => set(state => ({ failedTurn, failedTurns: [...state.failedTurns.filter(turn => turn.requestId !== failedTurn.requestId), failedTurn] })),
    prepareTurn: (content, requestId) => {
      const failed = get().failedTurns.find(turn => turn.content === content);
      return requestId ? { content, requestId } : failed?.content === content ? failed : { content, requestId: createRequestId() };
    },
    receivePage: page => {
      const acknowledged = new Set(page.items.map(message => message.requestId).filter(Boolean));
      set(state => ({
        failedTurns: state.failedTurns.filter(turn => !acknowledged.has(turn.requestId)),
        failedTurn: state.failedTurn && acknowledged.has(state.failedTurn.requestId) ? null : state.failedTurn,
      }));
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
      const turn = get().prepareTurn(content, requestId);
      if (get().outgoing.some(item => item.requestId === turn.requestId)) throw new Error("消息正在发送");
      set(state => ({ outgoing: [...state.outgoing, turn], failedTurns: state.failedTurns.filter(item => item.requestId !== turn.requestId), sendError: null }));
      try {
        const result = await send(turn.content, turn.requestId);
        set(state => ({ failedTurn: state.failedTurn?.requestId === turn.requestId ? null : state.failedTurn }));
        void client.cancelQueries({ queryKey: key, exact: true });
        client.setQueryData<MessagePage>(key, page => ({
          items: [...(page?.items ?? []).filter(item => item.id !== result.message.id), result.message],
          nextCursor: page?.nextCursor, replyStatus: page?.replyStatus,
        }));
        void client.invalidateQueries({ queryKey: ['matches'] });
        return result;
      } catch (error) {
        set(state => ({ failedTurn: turn, failedTurns: [...state.failedTurns, turn] }));
        set({ sendError: error instanceof Error ? error : new Error('消息发送失败') });
        throw error;
      } finally { set(state => ({ outgoing: state.outgoing.filter(item => item.requestId !== turn.requestId) })); }
    },
  }));
}
