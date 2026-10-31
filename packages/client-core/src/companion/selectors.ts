import type { CompanionStore } from './store';

export const companionSelectors = {
  entryLocked: (s: CompanionStore) => s.pendingIds.length > 0 || s.enteringId !== null,
  view: (s: CompanionStore) => ({
    pendingIds: s.pendingIds, enteringId: s.enteringId, error: s.error,
    filters: s.filters,
  }),
};

