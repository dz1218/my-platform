import type { CompanionStore } from './store';

export const companionSelectors = {
  view: (s: CompanionStore) => ({
    pendingIds: s.pendingIds, error: s.error,
    filters: s.filters,
  }),
};

