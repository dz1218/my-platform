'use client';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useStoreInstance } from '@/stores/use-store-instance';
import { createCompanionStore, companionSelectors } from '@/stores/companion';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { discover, matches } from '@/services/companion';
import { subscribeCompanionFilters } from '@/stores/companion/subscriptions';
import { useCompanionNavigation } from './companion-navigation';
import { useMatchesUpdates } from './use-matches-updates';
import type { Identity, Match } from '@/types/companion';

export type CardContext = { known: Map<string, Match>; busy: boolean; pendingId?: string; meet: (id: string) => void; prepareChat: () => void };
export function useCompanionHome(accountId: string | null, inheritedIdentity?: Identity | null) {
  const isLoggedIn = !!accountId;
  const router = useRouter();
  const client = useQueryClient();
  const { paused, prepareChat } = useCompanionNavigation();
  const ui = useStoreInstance(() => createCompanionStore({ client, accountId, openLogin: () => router.push('/login'), prepareChat, openChat: id => router.push(`/chat/${id}`, { scroll: false }) }));
  const { filters, initialTab, pendingId, error: meetError } = useStore(ui, useShallow(companionSelectors.view));
  const { applyFilters, initializeTab, meetIdentity, clearError } = ui.getState();
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => subscribeCompanionFilters(ui, client, accountId, () => heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' })), [ui, client, accountId]);
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
  const friends = useMemo(() => [...new Map((identities.data?.pages.flatMap(page => page.items) ?? []).filter(identity => identity.id !== inheritedIdentity?.id).map(identity => [identity.id, identity])).values()], [identities.data, inheritedIdentity?.id]);
  const recent = conversations.data?.items.filter(match => match.identity.id !== inheritedIdentity?.id);
  const known = useMemo(() => new Map(conversations.data?.items.map(match => [match.identity.id, match])), [conversations.data]);
  const cardContext = useMemo<CardContext>(() => ({ known, busy: !!pendingId || (isLoggedIn && (conversations.isPending || !!conversations.error)), pendingId: pendingId ?? undefined, meet: meetIdentity, prepareChat }), [known, isLoggedIn, pendingId, conversations.isPending, conversations.error, meetIdentity, prepareChat]);
  const loadMore = useCallback(() => { if (!paused && !identities.isFetching) void identities.fetchNextPage(); }, [paused, identities.isFetching, identities.fetchNextPage]);
  const error = (!identities.data ? identities.error : null) ?? conversations.error ?? meetError;
  const page = identities.data?.pages[0];
  const retry = () => { void identities.refetch(); if (isLoggedIn) void conversations.refetch(); clearError(); };
  return { initialTab, initializeTab, isLoggedIn, paused, prepareChat, filters, applyFilters, heading, identities, conversations, friends, recent, cardContext, loadMore, error, page, retry };
}
export type CompanionModel = ReturnType<typeof useCompanionHome>;
