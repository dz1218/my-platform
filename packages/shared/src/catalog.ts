import type { Identity } from './companion';

export type CatalogFilters = { q: string; occupationCode: string; ageMin: string; ageMax: string };
export const emptyCatalogFilters: CatalogFilters = { q: '', occupationCode: '', ageMin: '', ageMax: '' };
export type CatalogPage<T extends Identity = Identity> = {
  items: T[]; total: number; availableTotal: number; page: number; pageSize: number;
  nextPage: number | null; occupations: Array<{ code: string; name: string }>;
};
