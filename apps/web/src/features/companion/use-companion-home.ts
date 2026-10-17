'use client';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useStoreInstance } from '@/stores/use-store-instance';
import { createCompanionStore, companionSelectors } from '@/stores/companion';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { discover } from '@/services/companion';
import { matchesQueryOptions, sessionQueryOptions } from '@/services/query-options';
import { subscribeCompanionFilters } from '@/stores/companion/subscriptions';
import { useCompanionNavigation } from './companion-navigation';
import { useAccountLifecycle } from '@/features/account/account-lifecycle';
import type { Identity, Match } from '@/types/companion';

export type CardContext = { known: Map<string, Match>; busy: boolean; pendingId?: string; meet: (id: string) => void; prepareChat: () => void };
export function useCompanionHome(accountId: string | null, inheritedIdentity?: Identity | null) {
  const isLoggedIn = !!accountId;
  const router = useRouter();
  const client = useQueryClient();
  const { paused, prepareChat, captureNavigationIntent } = useCompanionNavigation();
  const { isLeavingAccount } = useAccountLifecycle();
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const isOwnerActive = useCallback(() => mounted.current && !isLeavingAccount(), [isLeavingAccount]);
  const ui = useStoreInstance(() => createCompanionStore({ client, accountId, isOwnerActive, captureNavigationIntent, openLogin: () => router.push('/login'), prepareChat, openChat: id => router.push(`/chat/${id}`, { scroll: false }) }));
  const { filters, initialTab, pendingId, error: meetError } = useStore(ui, useShallow(companionSelectors.view));
  const { applyFilters, initializeTab, meetIdentity, clearError } = ui.getState();
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!paused) return subscribeCompanionFilters(ui, client, accountId, () => heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' }));
  }, [ui, client, accountId, paused]);
  const catalogKey = useMemo(() => ['discover', accountId, filters], [accountId, filters]);
  const identities = useInfiniteQuery({
    ...sessionQueryOptions,
    queryKey: catalogKey, initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => discover(filters, pageParam, signal),
    getNextPageParam: page => page.nextPage ?? undefined,
    enabled: !paused,
  });
  // The account owner maintains one list socket, shared with the personal page.
  const conversations = useQuery({ ...matchesQueryOptions(accountId), enabled: isLoggedIn && !paused });
  useEffect(() => {
    if (paused) void client.cancelQueries({ queryKey: catalogKey });
  }, [paused, client, catalogKey, accountId]);
  const friends = useMemo(() => [...new Map((identities.data?.pages.flatMap(page => page.items) ?? []).filter(identity => identity.id !== inheritedIdentity?.id).map(identity => [identity.id, identity])).values()], [identities.data, inheritedIdentity?.id]);
  const recent = conversations.data?.items.filter(match => match.identity.id !== inheritedIdentity?.id);
  const known = useMemo(() => new Map(conversations.data?.items.map(match => [match.identity.id, match])), [conversations.data]);
  const cardContext = useMemo<CardContext>(() => ({ known, busy: !!pendingId || (isLoggedIn && !conversations.data), pendingId: pendingId ?? undefined, meet: meetIdentity, prepareChat }), [known, isLoggedIn, pendingId, conversations.data, meetIdentity, prepareChat]);
  const loadMore = useCallback(() => { if (!paused && !identities.isFetching) void identities.fetchNextPage(); }, [paused, identities.isFetching, identities.fetchNextPage]);
  const error = conversations.error ?? meetError;
  const page = identities.data?.pages[0];
  const retry = () => { if (isLoggedIn && conversations.error) void conversations.refetch(); clearError(); };
  return { initialTab, initializeTab, isLoggedIn, paused, prepareChat, filters, applyFilters, heading, identities, conversations, friends, recent, cardContext, loadMore, error, page, retry };
}
export type CompanionModel = ReturnType<typeof useCompanionHome>;
