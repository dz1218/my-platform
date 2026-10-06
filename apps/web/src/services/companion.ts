import { api } from "./api/client";
import type { Identity, Match } from "@/types/companion";
import { catalogSearch, type CatalogFilters, type CatalogPage } from "./catalog";
export const discover = (filters: CatalogFilters, page: number, signal?: AbortSignal) => api<CatalogPage<Identity>>(`/discover?${catalogSearch(filters, page)}`, { signal });
export const matches = () => api<{ items: Match[] }>("/matches");
export const getMatch = (id: string) =>
  api<Match>(`/matches/${encodeURIComponent(id)}`);
export const meet = (identityId: string) =>
  api<Match>("/matches", {
    method: "POST",
    body: JSON.stringify({ identityId }),
  });
