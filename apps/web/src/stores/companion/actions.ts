import type { QueryClient } from '@tanstack/react-query';
import type { StateCreator } from 'zustand/vanilla';
import { meet } from '@/services/companion';
import type { CatalogFilters } from '@/services/catalog';
import type { Match } from '@/types/companion';
import type { CompanionStore } from './store';

export type CompanionDependencies = { client: QueryClient; accountId: string | null; openChat: (id: string) => void; prepareChat: () => void; openLogin: () => void };
export type CompanionActions = {
  applyFilters: (filters: CatalogFilters) => void;
  initializeTab: (recentCount: number) => void;
  meetIdentity: (id: string) => Promise<void>;
  clearError: () => void;
};
export const createCompanionActions = ({ client, accountId, openChat, prepareChat, openLogin }: CompanionDependencies): StateCreator<CompanionStore, [['zustand/subscribeWithSelector', never]], [], CompanionActions> => (set, get) => ({
  applyFilters: value => {
    const filters = { ...value, q: value.q.trim() };
    if (filters.ageMin && filters.ageMax && Number(filters.ageMin) > Number(filters.ageMax)) return;
    if (Object.keys(filters).every(key => filters[key as keyof CatalogFilters] === get().filters[key as keyof CatalogFilters])) return;
    set({ filters });
  },
  initializeTab: recentCount => { if (!get().initialTab) set({ initialTab: recentCount ? 'recent' : 'discover' }); },
  clearError: () => set({ error: null }),
  meetIdentity: async id => {
    if (!accountId) { openLogin(); return; }
    if (get().pendingId || client.getQueryState(['matches', accountId])?.status !== 'success') return;
    // Capture focus before the pending state disables/replaces the trigger.
    prepareChat();
    set({ pendingId: id, error: null });
    try {
      const match = await meet(id);
      client.setQueryData<Match>(['match', match.id], match);
      client.setQueryData<{ items: Match[] }>(['matches', accountId], previous => ({ items: [match, ...(previous?.items.filter(item => item.id !== match.id) ?? [])] }));
      openChat(match.id);
    } catch (error) { set({ error: error instanceof Error ? error : new Error('暂时无法开始聊天') }); }
    finally { set({ pendingId: null }); }
  },
});
