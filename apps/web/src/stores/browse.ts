import { createDomainStore } from './create-store';

export type BrowseState = {
  profileTab: 'recent' | 'identity';
  profileChatPage: number;
  setProfileChatPage: (page: number) => void;
  liveSearch: string;
  liveFilter: '全部' | '直播中' | '准备中';
  lastCompanionHref: string;
  setProfileTab: (tab: BrowseState['profileTab']) => void;
  setLiveSearch: (search: string) => void;
  setLiveFilter: (filter: BrowseState['liveFilter']) => void;
  rememberCompanionHref: (href: string) => void;
};

/** Harmless browsing choices last for this account's current document only. */
export function createBrowseStore() {
  return createDomainStore<BrowseState>()(set => ({
    profileTab: 'recent', liveSearch: '', liveFilter: '全部', lastCompanionHref: '/companion',
    profileChatPage: 1,
    setProfileChatPage: page => {
      if (Number.isInteger(page) && page > 0) set({ profileChatPage: page });
    },
    setProfileTab: profileTab => set({ profileTab }),
    setLiveSearch: liveSearch => set({ liveSearch }),
    setLiveFilter: liveFilter => set({ liveFilter }),
    rememberCompanionHref: lastCompanionHref => {
      if (lastCompanionHref === '/companion' || lastCompanionHref.startsWith('/companion?')) set({ lastCompanionHref });
    },
  }));
}
