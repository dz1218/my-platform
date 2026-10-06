import { api, APIError } from './api/client';
import { catalogSearch, type CatalogFilters, type CatalogPage } from './catalog';
import type { Gender, Identity, InheritanceState } from '@/types/companion';

export const getInheritance = async (selectedId?: string | null, signal?: AbortSignal) => {
  try {
    const params = new URLSearchParams({ includeItems: 'false' });
    if (selectedId) params.set('selectedId', selectedId);
    const state = await api<InheritanceState>(`/identity-inheritance?${params}`, { signal });
    return { ...state, selectedRequestId: selectedId ?? null };
  } catch (error) {
    // An older API serves a plain 404 when this feature has not been deployed.
    // Preserve structured errors from APIs that already support inheritance.
    if (error instanceof APIError && error.status === 404 && !error.code) {
      throw new APIError('身份选择功能暂未就绪，请稍后刷新', 404, 'inheritance_unavailable');
    }
    throw error;
  }
};
export const inheritIdentity = (identityId: string) => api<{ identity: Identity }>('/identity-inheritance', {
  method: 'POST', body: JSON.stringify({ identityId }),
});
export const skipInheritance = () => api<{ ok: boolean }>('/identity-inheritance/skip', {
  method: 'POST', body: JSON.stringify({}),
});
export const setInheritanceGender = (gender: Gender) => api<{ ok: boolean }>('/identity-inheritance/gender', {
  method: 'POST', body: JSON.stringify({ gender }),
});

export const inheritanceOptions = (filters: CatalogFilters, page: number, signal?: AbortSignal) =>
  api<CatalogPage<Identity & { available: boolean }>>(`/identity-inheritance/options?${catalogSearch(filters, page)}`, { signal });
