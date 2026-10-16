'use client';
import { useEffect, useRef } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useStore } from 'zustand';
import { autoReply, history, ChatConnection } from '@/services/chat';
import { createConversationStore, conversationSelectors, mergeConversationMessages } from '@/stores/chat/conversation';
import { useStoreInstance } from '@/stores/use-store-instance';

export function useConversation(conversationId: string) {
  const client = useQueryClient();
  const connection = useRef<ChatConnection | null>(null);
  const ui = useStoreInstance(() => createConversationStore({
    client, conversationId,
    send: (content, requestId) => connection.current?.send(content, requestId) ?? Promise.reject(new Error('聊天正在连接，请稍后重试')),
  }));
  const error = useStore(ui, conversationSelectors.error);
  const outgoing = useStore(ui, conversationSelectors.outgoing);
  const sending = useStore(ui, conversationSelectors.sending);
  const { setConnectionError, receivePage, receiveSettings, send } = ui.getState();
  const latest = useQuery({ queryKey: ['messages', conversationId], queryFn: ({ signal }) => history(conversationId, undefined, signal), enabled: !!conversationId });
  const settings = useQuery({ queryKey: ['auto-reply', conversationId], queryFn: ({ signal }) => autoReply(conversationId, signal) });

  // The effect owns the connection; actions own reconciliation and sending.
  useEffect(() => {
    const socket = new ChatConnection(conversationId, receivePage, setConnectionError, receiveSettings);
    connection.current = socket;
    return () => { connection.current = null; socket.close(); };
  }, [conversationId, receivePage, setConnectionError, receiveSettings]);
  const older = useInfiniteQuery({
    queryKey: ['older-messages', conversationId], enabled: false, initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => history(conversationId, pageParam ?? latest.data?.nextCursor),
    getNextPageParam: page => page.nextCursor, staleTime: Infinity,
  });
  const messages = mergeConversationMessages(older.data?.pages ?? [], latest.data);
  return {
    messages, typing: () => connection.current?.typing(), settings, latest, error, sending, send,
    outgoing: outgoing && !messages.some(message => message.requestId === outgoing.requestId) ? outgoing : null,
    hasOlder: older.data ? older.hasNextPage : !!latest.data?.nextCursor,
    loadingOlder: older.isFetchingNextPage, olderError: older.error, loadOlder: () => older.fetchNextPage(),
  };
}
