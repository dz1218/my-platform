import { emptyCatalogFilters, type CatalogFilters } from '@/services/catalog';
export type CompanionTab = 'recent' | 'discover';

export type CompanionState = {
  pendingId: string | null;
  error: Error | null;
  filters: CatalogFilters;
  initialTab: CompanionTab | null;
};

export const initialCompanionState = (): CompanionState => ({
  pendingId: null, error: null,
  filters: { ...emptyCatalogFilters },
  initialTab: null,
});

