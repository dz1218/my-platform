import type { CompanionStore } from './store';

export const companionSelectors = {
  view: (s: CompanionStore) => ({
    pendingId: s.pendingId, error: s.error,
    filters: s.filters,
  }),
};

