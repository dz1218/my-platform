import type { QueryClient } from '@tanstack/query-core';
import type { StateCreator } from 'zustand/vanilla';
import type { CompanionService } from '../contracts';
import type { CatalogFilters } from '@my-platform/shared';
import type { Match } from '@my-platform/shared';
import type { CompanionStore } from './store';
import { validateCatalogFilters } from '../catalog';

export type CompanionDependencies = { client: QueryClient; service: CompanionService; accountId: string | null; isOwnerActive: () => boolean; captureNavigationIntent: () => () => boolean; openChat: (id: string) => void; prepareChat: () => void; openLogin: () => void };
export type CompanionActions = {
  applyFilters: (filters: CatalogFilters) => void;
  meetIdentity: (id: string) => Promise<void>;
  clearError: () => void;
};
export const createCompanionActions = ({ client, service, accountId, isOwnerActive, captureNavigationIntent, openChat, prepareChat, openLogin }: CompanionDependencies): StateCreator<CompanionStore, [['zustand/subscribeWithSelector', never]], [], CompanionActions> => (set, get) => ({
  applyFilters: value => {
    const filters = { ...value, q: value.q.trim() };
    if (validateCatalogFilters(filters)) return;
    if (Object.keys(filters).every(key => filters[key as keyof CatalogFilters] === get().filters[key as keyof CatalogFilters])) return;
    set({ filters });
  },
  clearError: () => set({ error: null }),
  meetIdentity: async id => {
    if (!isOwnerActive()) return;
    if (!accountId) { openLogin(); return; }
    // A failed background refresh can leave usable cached matches with status=error.
    if (get().pendingIds.includes(id) || !client.getQueryData(['matches', accountId])) return;
    // Capture focus before the pending state disables/replaces the trigger.
    prepareChat();
    const canNavigate = captureNavigationIntent();
    set(state => ({ pendingIds: [...state.pendingIds, id], error: null }));
    try {
      const match = await service.meet(id);
      if (!isOwnerActive()) return;
      client.setQueryData<Match>(['match', match.id], match);
      client.setQueryData<{ items: Match[] }>(['matches', accountId], previous => ({ items: [match, ...(previous?.items.filter(item => item.id !== match.id) ?? [])] }));
      // A successful greeting still belongs in this account's list. Navigation
      // belongs to its original intent; another greeting or leaving invalidates it.
      if (canNavigate()) openChat(match.id);
    } catch (error) { if (isOwnerActive() && canNavigate()) set({ error: error instanceof Error ? error : new Error('暂时无法开始聊天') }); }
    finally { if (isOwnerActive()) set(state => ({ pendingIds: state.pendingIds.filter(pending => pending !== id) })); }
  },
});
