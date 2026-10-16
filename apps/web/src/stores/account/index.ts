import { createDomainStore } from '@/stores/create-store';

type Tab = 'recent' | 'identity';
export type AccountStore = {
  tab: Tab;
  indicatorMotion: 'left' | 'right' | null;
  selectTab: (tab: Tab) => void;
};

export const accountSelectors = {
  tab: (s: AccountStore) => s.tab,
  indicatorMotion: (s: AccountStore) => s.indicatorMotion,
};

export function createAccountStore() {
  return createDomainStore<AccountStore>()((set) => ({
    tab: 'recent',
    indicatorMotion: null,
    selectTab: (tab) => set(s => s.tab === tab ? s : ({ tab, indicatorMotion: tab === 'identity' ? 'right' : 'left' })),
  }));
}
