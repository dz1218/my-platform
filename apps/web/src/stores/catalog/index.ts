import { createDomainStore } from '@/stores/create-store';
import { emptyCatalogFilters, type CatalogFilters } from '@/services/catalog';

export type CatalogFormStore = {
  draft: CatalogFilters;
  search: string;
  open: boolean;
  setDraft: (draft: CatalogFilters) => void;
  setSearch: (search: string) => void;
  setOpen: (open: boolean) => void;
  resetDraft: (search?: string) => CatalogFilters;
  prepareFilters: () => CatalogFilters | null;
};

export const catalogSelectors = {
  draft: (s: CatalogFormStore) => s.draft,
  search: (s: CatalogFormStore) => s.search,
  open: (s: CatalogFormStore) => s.open,
};

// One instance per editor. Closing the sheet discards its unsubmitted draft.
export function createCatalogFormStore(value: CatalogFilters) {
  return createDomainStore<CatalogFormStore>()((set, get) => ({
    draft: { ...value }, search: value.q, open: false,
    setDraft: draft => set({ draft }),
    setSearch: search => set({ search }),
    setOpen: open => set({ open }),
    resetDraft: (q = '') => {
      const draft = { ...emptyCatalogFilters, q };
      set({ draft });
      return draft;
    },
    prepareFilters: () => {
      const draft = get().draft;
      if (draft.ageMin && draft.ageMax && Number(draft.ageMin) > Number(draft.ageMax)) return null;
      return { ...draft, q: draft.q.trim() };
    },
  }));
}
