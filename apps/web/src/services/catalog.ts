import type { CatalogFilters } from '@my-platform/shared';
export { emptyCatalogFilters } from '@my-platform/shared';
export type { CatalogFilters, CatalogPage } from '@my-platform/shared';

export function catalogSearch(filters: CatalogFilters, page: number) {
  const params = new URLSearchParams({ page: String(page), pageSize: '24' });
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  return params.toString();
}
