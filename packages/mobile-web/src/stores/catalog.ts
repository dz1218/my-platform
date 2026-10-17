import { createDomainStore } from '@my-platform/client-core';
import { validateCatalogFilters } from '@my-platform/client-core/catalog';
import type { CatalogFilters } from '@my-platform/shared';

type MobileCatalogState = {
  open: boolean;
  search: string;
  draft: CatalogFilters;
  error: string | null;
  editSearch: (search: string) => void;
  syncSearch: (search: string) => void;
  begin: (applied: CatalogFilters) => void;
  cancel: () => void;
  edit: (patch: Partial<CatalogFilters>) => void;
  reset: () => void;
  apply: () => CatalogFilters | null;
  submitSearch: (applied: CatalogFilters) => CatalogFilters;
};

/** A sheet draft lives only for this mounted mobile editor; it is never persisted. */
export function createMobileCatalogStore(value: CatalogFilters) {
  return createDomainStore<MobileCatalogState>()((set, get) => ({
    open: false, search: value.q, draft: { ...value }, error: null,
    editSearch: search => set({ search }),
    syncSearch: search => set({ search }),
    begin: applied => set({ open: true, draft: { ...applied }, error: null }),
    cancel: () => set({ open: false, error: null }),
    edit: patch => set(state => ({ draft: { ...state.draft, ...patch }, error: null })),
    reset: () => set(state => ({ draft: { q: state.draft.q, occupationCode: '', ageMin: '', ageMax: '' }, error: null })),
    apply: () => {
      const draft = get().draft;
      const error = validateCatalogFilters(draft);
      if (error) {
        set({ error });
        return null;
      }
      set({ open: false, error: null });
      return { ...draft, q: draft.q.trim() };
    },
    submitSearch: applied => ({ ...applied, q: get().search.trim() }),
  }));
}
