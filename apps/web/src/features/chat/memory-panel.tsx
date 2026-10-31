'use client';
import { useEffect } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createMemoryStore, type MemoryPreferences, type MemoryCollection } from '@my-platform/client-core/chat/memory';
import { MemoryPanelBody, type MemoryPanelProps } from '@my-platform/web-ui/memory-panel';
import { MobileMemoryPanel } from '@my-platform/mobile-web/memory';
import { useViewport } from '@my-platform/web-ui/use-viewport';
import { useStoreInstance } from '@/stores/use-store-instance';
import { api } from '@/services/api/client';

export function CompanionMemoryPanel({ id }: { id: string }) {
  const client = useQueryClient(), viewport = useViewport();
  const base = `/conversations/${encodeURIComponent(id)}`;
  const preferences = useQuery({ queryKey: ['memory-preferences', id], queryFn: () => api<MemoryPreferences>(`${base}/memory-preferences`), retry: false });
  const memories = useInfiniteQuery({ queryKey: ['memories', id], initialPageParam: 0, queryFn: ({ pageParam }) => api<MemoryCollection>(`${base}/memories${pageParam ? `?cursor=${pageParam}` : ''}`), getNextPageParam: last => last.nextCursor, retry: false, refetchInterval: preferences.data?.enabled ? 30_000 : false });
  const store = useStoreInstance(() => createMemoryStore({ id, client, service: { write: (path, body, method = 'POST') => api(`${base}${path}`, { method, body: JSON.stringify(body) }) } }));
  useEffect(() => store.getState().activate(), [store]);
  const state = useStore(store, useShallow(s => ({ busy: s.busy, pendingEnabled: s.pendingEnabled, error: s.error, notice: s.notice, draft: s.draft, confirmation: s.confirmation })));
  const actions = store.getState();
  const items = [...new Map((memories.data?.pages.flatMap(page => page.items) ?? []).map(m => [m.id,m])).values()];
  const proposals = [...new Map((memories.data?.pages.flatMap(page => page.proposals) ?? []).map(m => [m.id,m])).values()];
  const props: MemoryPanelProps = {
    ...state, enabled: state.pendingEnabled ?? preferences.data?.enabled ?? false, loading: preferences.isPending || memories.isPending,
    loadError: preferences.error?.message || memories.error?.message || '', items, proposals, confirming: !!state.confirmation,
    onEnabled: value => { void actions.setEnabled(value); }, onRetry: () => { void preferences.refetch(); void memories.refetch(); },
    onEdit: id => { const m = items.find(m => m.id === id); if (m) actions.edit(m); }, onDraft: actions.setDraft,
    onSave: () => { void actions.save(); }, onCancel: actions.cancel,
    onDelete: id => { const m = items.find(m => m.id === id); if (m) actions.requestDelete(m); },
    onResolve: (id, accept) => { const m = proposals.find(m => m.id === id); if (m) void actions.resolve(m, accept); },
    onClear: actions.requestClear, onConfirm: () => { void actions.confirm(); },
    hasMore: memories.hasNextPage, loadingMore: memories.isFetchingNextPage, onLoadMore: () => { void memories.fetchNextPage(); },
  };
  return viewport === 'mobile' ? <MobileMemoryPanel {...props} /> : <section className="px-5 py-4"><h3 className="mb-3 text-sm font-semibold">记忆</h3><MemoryPanelBody {...props} /></section>;
}
