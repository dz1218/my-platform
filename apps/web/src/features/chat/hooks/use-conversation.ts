'use client';
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { history, ChatConnection } from '@/services/chat';
import type { Message, MessagePage } from '@/types/companion';

type Turn = { content: string; requestId: string };
export function useConversation(conversationId: string) {
  const client = useQueryClient();
  const key = ['messages', conversationId] as const;
  const latest = useQuery({
    queryKey: key, queryFn: ({ signal }) => history(conversationId, undefined, signal), enabled: !!conversationId,
  });
  const connection = useRef<ChatConnection | null>(null);
  const [connectionError, setConnectionError] = useState<Error | null>(null);
  useEffect(() => {
    const socket = new ChatConnection(conversationId, page => {
      void client.cancelQueries({ queryKey: ['messages', conversationId], exact: true });
      client.setQueryData(['messages', conversationId], page);
      void client.invalidateQueries({ queryKey: ['matches'] });
    }, setConnectionError);
    connection.current = socket;
    return () => { connection.current = null; socket.close(); };
  }, [conversationId, client]);
  // Historical pages remain cached; live updates arrive over WebSocket.
  const older = useInfiniteQuery({
    queryKey: ['older-messages', conversationId], enabled: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => history(conversationId, pageParam ?? latest.data?.nextCursor),
    getNextPageParam: page => page.nextCursor,
    staleTime: Infinity,
  });
  const failedTurn = useRef<Turn | null>(null);
  const [outgoing, setOutgoing] = useState<Turn | null>(null);
  const mutation = useMutation({
    mutationFn: (turn: Turn) => connection.current?.send(turn.content, turn.requestId) ?? Promise.reject(new Error('聊天正在连接，请稍后重试')),
    onMutate: turn => setOutgoing(turn),
    onSuccess: ({ message }) => {
      failedTurn.current = null;
      void client.cancelQueries({ queryKey: key, exact: true });
      client.setQueryData<MessagePage>(key, page => ({ items: [...(page?.items ?? []).filter(item => item.id !== message.id), message], nextCursor: page?.nextCursor }));
      void client.invalidateQueries({ queryKey: ['matches'] });
    },
    onError: (_error, turn) => { failedTurn.current = turn; },
    onSettled: () => setOutgoing(null),
  });
  const map = new Map<string, Message>();
  for (const page of older.data?.pages ?? []) for (const message of page.items) map.set(message.id, message);
  for (const message of latest.data?.items ?? []) map.set(message.id, message);
  const messages = [...map.values()].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
  const send = (content: string, requestId?: string) => {
    const turn = requestId ? { content, requestId } : failedTurn.current?.content === content ? failedTurn.current : { content, requestId: crypto.randomUUID() };
    return mutation.mutateAsync(turn);
  };
  return {
    messages, latest, error: mutation.error ?? connectionError, sending: mutation.isPending, send,
    outgoing: outgoing && !messages.some(message => message.requestId === outgoing.requestId) ? outgoing : null,
    hasOlder: older.data ? older.hasNextPage : !!latest.data?.nextCursor,
    loadingOlder: older.isFetchingNextPage,
    olderError: older.error,
    loadOlder: () => older.fetchNextPage(),
  };
}
