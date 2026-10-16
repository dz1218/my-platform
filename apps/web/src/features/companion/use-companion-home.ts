'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { discover, matches, meet } from '@/services/companion';
import { emptyCatalogFilters, type CatalogFilters as Filters } from '@/services/catalog';
import { useCompanionNavigation } from './companion-navigation';
import { useMatchesUpdates } from './use-matches-updates';
import type { Identity, Match } from '@/types/companion';

export type CardContext = { known: Map<string, Match>; busy: boolean; pendingId?: string; meet: (id: string) => void; prepareChat: () => void };
export function useCompanionHome(accountId: string | null, inheritedIdentity?: Identity | null) {
  const isLoggedIn = !!accountId;
  const router = useRouter();
  const client = useQueryClient();
  const { paused, prepareChat } = useCompanionNavigation();
  const [filters, setFilters] = useState<Filters>(emptyCatalogFilters);
  const heading = useRef<HTMLDivElement>(null);
  const catalogKey = useMemo(() => ['discover', accountId, filters], [accountId, filters]);
  const identities = useInfiniteQuery({
    queryKey: catalogKey, initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => discover(filters, pageParam, signal),
    getNextPageParam: page => page.nextPage ?? undefined,
    enabled: !paused, staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  // Account updates keep the visible list live. HTTP is still a fallback on
  // mount/focus/reconnect, including a quick return within the global cache TTL.
  const conversations = useQuery({ queryKey: ['matches', accountId], queryFn: ({ signal }) => matches(signal), enabled: isLoggedIn && !paused, staleTime: 0 });
  useMatchesUpdates(accountId, paused);
  useEffect(() => {
    if (paused) { void client.cancelQueries({ queryKey: catalogKey }); void client.cancelQueries({ queryKey: ['matches', accountId] }); }
  }, [paused, client, catalogKey, accountId]);
  const mutation = useMutation({ mutationFn: meet, onSuccess: match => {
    client.setQueryData<Match>(['match', match.id], match);
    client.setQueryData<{ items: Match[] }>(['matches', accountId], previous => ({ items: [match, ...(previous?.items.filter(item => item.id !== match.id) ?? [])] }));
    prepareChat();
    router.push(`/chat/${match.id}`, { scroll: false });
  } });
  const friends = useMemo(() => [...new Map((identities.data?.pages.flatMap(page => page.items) ?? []).filter(identity => identity.id !== inheritedIdentity?.id).map(identity => [identity.id, identity])).values()], [identities.data, inheritedIdentity?.id]);
  const recent = conversations.data?.items.filter(match => match.identity.id !== inheritedIdentity?.id);
  const known = useMemo(() => new Map(conversations.data?.items.map(match => [match.identity.id, match])), [conversations.data]);
  const meetIdentity = useCallback((id: string) => {
    if (!isLoggedIn) { router.push('/login'); return; }
    mutation.mutate(id);
  }, [isLoggedIn, router, mutation.mutate]);
  const cardContext = useMemo<CardContext>(() => ({ known, busy: mutation.isPending || (isLoggedIn && (conversations.isPending || !!conversations.error)), pendingId: mutation.isPending ? mutation.variables : undefined, meet: meetIdentity, prepareChat }), [known, isLoggedIn, mutation.isPending, mutation.variables, conversations.isPending, conversations.error, meetIdentity, prepareChat]);
  const loadMore = useCallback(() => { if (!paused && !identities.isFetching) void identities.fetchNextPage(); }, [paused, identities.isFetching, identities.fetchNextPage]);
  const error = (!identities.data ? identities.error : null) ?? conversations.error ?? mutation.error;
  const page = identities.data?.pages[0];
  const applyFilters = (next: Filters) => {
    void client.cancelQueries({ queryKey: catalogKey });
    setFilters(next);
    heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  };
  const retry = () => { void identities.refetch(); if (isLoggedIn) void conversations.refetch(); mutation.reset(); };
  return { isLoggedIn, paused, prepareChat, filters, applyFilters, heading, identities, conversations, friends, recent, cardContext, loadMore, error, page, retry };
}
export type CompanionModel = ReturnType<typeof useCompanionHome>;
