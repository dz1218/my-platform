import { emptyCatalogFilters, type CatalogFilters } from '@my-platform/shared';

export type CompanionState = {
  pendingId: string | null;
  error: Error | null;
  filters: CatalogFilters;
};

export const initialCompanionState = (): CompanionState => ({
  pendingId: null, error: null,
  filters: { ...emptyCatalogFilters },
});

