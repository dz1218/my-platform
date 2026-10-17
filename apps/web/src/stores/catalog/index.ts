import { createCatalogFormStore as createCoreCatalogFormStore, catalogSelectors as coreSelectors, type CatalogFormStore as CoreCatalogFormStore } from '@my-platform/client-core';
import type { CatalogFilters } from '@my-platform/shared';
import { withPresentation } from '../with-presentation';
type CatalogPresentation = { open: boolean; setOpen: (open: boolean) => void };
export type CatalogFormStore = CoreCatalogFormStore & CatalogPresentation;
export const catalogSelectors = { ...coreSelectors, open: (state: CatalogFormStore) => state.open };
export const createCatalogFormStore = (value: CatalogFilters) =>
  withPresentation<CoreCatalogFormStore, CatalogPresentation>(createCoreCatalogFormStore(value), set => ({ open: false, setOpen: open => set({ open }) }));
