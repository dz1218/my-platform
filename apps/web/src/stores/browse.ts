import { createDomainStore } from './create-store';

export type BrowseState = {
  profileTab: 'recent' | 'identity';
  profileChatPage: number;
  setProfileChatPage: (page: number) => void;
  novelSearchDraft: string;
  novelSearch: string;
  novelPage: number;
  setNovelSearchDraft: (draft: string) => void;
  searchNovels: (query: string) => void;
  setNovelPage: (page: number) => void;
  liveSearchDraft: string;
  liveSearch: string;
  liveFilter: '全部' | '直播中' | '准备中';
  lastCompanionHref: string;
  setProfileTab: (tab: BrowseState['profileTab']) => void;
  setLiveSearchDraft: (draft: string) => void;
  setLiveSearch: (search: string) => void;
  setLiveFilter: (filter: BrowseState['liveFilter']) => void;
  rememberCompanionHref: (href: string) => void;
};

/** Harmless browsing choices last for this account's current document only. */
export function createBrowseStore() {
  return createDomainStore<BrowseState>()(set => ({
    profileTab: 'recent', liveSearchDraft: '', liveSearch: '', liveFilter: '全部', lastCompanionHref: '/companion',
    profileChatPage: 1,
    novelSearchDraft: '', novelSearch: '', novelPage: 1,
    setNovelSearchDraft: novelSearchDraft => set({ novelSearchDraft }),
    searchNovels: query => {
      const novelSearch = query.trim().slice(0, 80);
      set({ novelSearch, novelSearchDraft: novelSearch, novelPage: 1 });
    },
    setNovelPage: novelPage => {
      if (Number.isInteger(novelPage) && novelPage > 0) set({ novelPage });
    },
    setProfileChatPage: page => {
      if (Number.isInteger(page) && page > 0) set({ profileChatPage: page });
    },
    setProfileTab: profileTab => set({ profileTab }),
    setLiveSearchDraft: liveSearchDraft => set({ liveSearchDraft }),
    setLiveSearch: query => {
      const liveSearch = query.trim().slice(0, 80);
      set({ liveSearch, liveSearchDraft: liveSearch });
    },
    setLiveFilter: liveFilter => set({ liveFilter }),
    rememberCompanionHref: lastCompanionHref => {
      if (lastCompanionHref === '/companion' || lastCompanionHref.startsWith('/companion?')) set({ lastCompanionHref });
    },
  }));
}
