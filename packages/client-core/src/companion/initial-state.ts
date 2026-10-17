import { emptyCatalogFilters, type CatalogFilters } from '@my-platform/shared';

export type CompanionState = {
  pendingIds: string[];
  enteringId: string | null;
  error: Error | null;
  filters: CatalogFilters;
};

export const initialCompanionState = (): CompanionState => ({
  pendingIds: [], enteringId: null, error: null,
  filters: { ...emptyCatalogFilters },
});

