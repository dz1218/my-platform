import { emptyCatalogFilters, type CatalogFilters } from '@my-platform/shared';

export type CompanionState = {
  pendingIds: string[];
  error: Error | null;
  filters: CatalogFilters;
};

export const initialCompanionState = (): CompanionState => ({
  pendingIds: [], error: null,
  filters: { ...emptyCatalogFilters },
});

