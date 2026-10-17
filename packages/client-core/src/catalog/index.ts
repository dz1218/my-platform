import { createDomainStore } from '../create-store';
import { emptyCatalogFilters, type CatalogFilters } from '@my-platform/shared';

/** Shared with mobile editors so request validation follows the API's age range. */
export function validateCatalogFilters(filters: CatalogFilters): string | null {
  const ages = [filters.ageMin, filters.ageMax].filter(Boolean);
  if (ages.some(value => !/^\d+$/.test(value) || Number(value) < 18 || Number(value) > 50)) {
    return '年龄请输入 18–50 之间的整数。';
  }
  if (filters.ageMin && filters.ageMax && Number(filters.ageMin) > Number(filters.ageMax)) {
    return '最大年龄不能小于最小年龄。';
  }
  return null;
}

export type CatalogFormStore = {
  draft: CatalogFilters;
  search: string;
  setDraft: (draft: CatalogFilters) => void;
  setSearch: (search: string) => void;
  resetDraft: (search?: string) => CatalogFilters;
  prepareFilters: () => CatalogFilters | null;
};

export const catalogSelectors = {
  draft: (s: CatalogFormStore) => s.draft,
  search: (s: CatalogFormStore) => s.search,
};

// One instance per editor. Closing the sheet discards its unsubmitted draft.
export function createCatalogFormStore(value: CatalogFilters) {
  return createDomainStore<CatalogFormStore>()((set, get) => ({
    draft: { ...value }, search: value.q,
    setDraft: draft => set({ draft }),
    setSearch: search => set({ search }),
    resetDraft: (q = '') => {
      const draft = { ...emptyCatalogFilters, q };
      set({ draft });
      return draft;
    },
    prepareFilters: () => {
      const draft = get().draft;
      if (validateCatalogFilters(draft)) return null;
      return { ...draft, q: draft.q.trim() };
    },
  }));
}
