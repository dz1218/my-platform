import type { Identity } from '@/types/companion';

export type CatalogFilters = { q: string; occupationCode: string; ageMin: string; ageMax: string };
export const emptyCatalogFilters: CatalogFilters = { q: '', occupationCode: '', ageMin: '', ageMax: '' };
export type CatalogPage<T extends Identity = Identity> = {
  items: T[]; total: number; availableTotal: number; page: number; pageSize: number;
  nextPage: number | null; occupations: Array<{ code: string; name: string }>;
};
export function catalogSearch(filters: CatalogFilters, page: number) {
  const params = new URLSearchParams({ page: String(page), pageSize: '24' });
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  return params.toString();
}
