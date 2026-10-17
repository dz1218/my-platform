import type { CompanionStore } from './store';

export const companionSelectors = {
  view: (s: CompanionStore) => ({
    pendingIds: s.pendingIds, enteringId: s.enteringId, error: s.error,
    filters: s.filters,
  }),
};

