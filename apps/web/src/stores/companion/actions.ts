import type { QueryClient } from '@tanstack/react-query';
import type { StateCreator } from 'zustand/vanilla';
import { meet } from '@/services/companion';
import type { CatalogFilters } from '@/services/catalog';
import type { Match } from '@/types/companion';
import type { CompanionStore } from './store';

export type CompanionDependencies = { client: QueryClient; accountId: string | null; isOwnerActive: () => boolean; captureNavigationIntent: () => () => boolean; openChat: (id: string) => void; prepareChat: () => void; openLogin: () => void };
export type CompanionActions = {
  applyFilters: (filters: CatalogFilters) => void;
  initializeTab: (recentCount: number) => void;
  meetIdentity: (id: string) => Promise<void>;
  clearError: () => void;
};
export const createCompanionActions = ({ client, accountId, isOwnerActive, captureNavigationIntent, openChat, prepareChat, openLogin }: CompanionDependencies): StateCreator<CompanionStore, [['zustand/subscribeWithSelector', never]], [], CompanionActions> => (set, get) => ({
  applyFilters: value => {
    const filters = { ...value, q: value.q.trim() };
    if (filters.ageMin && filters.ageMax && Number(filters.ageMin) > Number(filters.ageMax)) return;
    if (Object.keys(filters).every(key => filters[key as keyof CatalogFilters] === get().filters[key as keyof CatalogFilters])) return;
    set({ filters });
  },
  initializeTab: recentCount => { if (!get().initialTab) set({ initialTab: recentCount ? 'recent' : 'discover' }); },
  clearError: () => set({ error: null }),
  meetIdentity: async id => {
    if (!isOwnerActive()) return;
    if (!accountId) { openLogin(); return; }
    // A failed background refresh can leave usable cached matches with status=error.
    if (get().pendingId || !client.getQueryData(['matches', accountId])) return;
    // Capture focus before the pending state disables/replaces the trigger.
    prepareChat();
    const canNavigate = captureNavigationIntent();
    set({ pendingId: id, error: null });
    try {
      const match = await meet(id);
      if (!isOwnerActive()) return;
      client.setQueryData<Match>(['match', match.id], match);
      client.setQueryData<{ items: Match[] }>(['matches', accountId], previous => ({ items: [match, ...(previous?.items.filter(item => item.id !== match.id) ?? [])] }));
      // A successful greeting still belongs in this account's list. Navigation
      // belongs to its original intent, which leaving and returning invalidates.
      if (canNavigate()) openChat(match.id);
    } catch (error) { if (isOwnerActive()) set({ error: error instanceof Error ? error : new Error('暂时无法开始聊天') }); }
    finally { if (isOwnerActive()) set({ pendingId: null }); }
  },
});
