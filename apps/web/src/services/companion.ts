import { api } from './api/client';
import type { Identity, Match } from '@/types/companion';
export const discover = () => api<{ items: Identity[] }>('/discover');
export const matches = () => api<{ items: Match[] }>('/matches');
export const getMatch = (id: string) => api<Match>(`/matches/${encodeURIComponent(id)}`);
export const meet = (identityId: string) => api<Match>('/matches', { method: 'POST', body: JSON.stringify({ identityId }) });
