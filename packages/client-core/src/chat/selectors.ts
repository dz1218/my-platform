import type { ChatStore } from './store';

export const chatSelectors = {
  draft: (id: string) => (s: ChatStore) => s.drafts[id] ?? '',
};
