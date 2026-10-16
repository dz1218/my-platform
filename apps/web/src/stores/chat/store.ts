import { createDomainStore } from '@/stores/create-store';

export type ChatStore = {
  drafts: Record<string, string>;
  setDraft: (id: string, value: string) => void;
  clearSentDraft: (id: string, sent: string) => void;
};

// Created by the account provider, never a process-wide singleton.
export function createChatStore() {
  return createDomainStore<ChatStore>()((set) => ({
    drafts: {},
    setDraft: (id, value) => set((state) => ({ drafts: { ...state.drafts, [id]: value } })),
    clearSentDraft: (id, sent) => set((state) => {
      if (state.drafts[id] !== sent) return state;
      const drafts = { ...state.drafts };
      delete drafts[id];
      return { drafts };
    }),
  }));
}
