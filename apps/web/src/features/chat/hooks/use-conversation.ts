'use client';
import { useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { history, sendMessage } from '@/services/chat';
import type { Message, MessagePage } from '@/types/companion';

type Turn = { content: string; requestId: string };
export function useConversation(conversationId: string) {
  const client = useQueryClient();
  const key = ['messages', conversationId] as const;
  const latest = useQuery({
    queryKey: key, queryFn: () => history(conversationId), enabled: !!conversationId,
    refetchInterval: 2500, refetchIntervalInBackground: false,
  });
  // Only the newest page polls. Historical pages remain cached.
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
    mutationFn: (turn: Turn) => sendMessage(conversationId, turn.content, turn.requestId),
    onMutate: turn => setOutgoing(turn),
    onSuccess: ({ message }) => {
      failedTurn.current = null;
      client.setQueryData<MessagePage>(key, page => ({ items: [...(page?.items ?? []).filter(item => item.id !== message.id), message], nextCursor: page?.nextCursor }));
      void client.invalidateQueries({ queryKey: ['matches'] });
    },
    onError: (_error, turn) => { failedTurn.current = turn; },
    onSettled: async () => { await client.invalidateQueries({ queryKey: key }); setOutgoing(null); },
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
    messages, latest, error: mutation.error, sending: mutation.isPending, send,
    outgoing: outgoing && !messages.some(message => message.requestId === outgoing.requestId) ? outgoing : null,
    hasOlder: older.data ? older.hasNextPage : !!latest.data?.nextCursor,
    loadingOlder: older.isFetchingNextPage,
    olderError: older.error,
    loadOlder: () => older.fetchNextPage(),
  };
}
