import type { QueryClient } from '@tanstack/query-core';
import type { createIdentityStore } from './store';

export const subscribeIdentitySelection = (store: ReturnType<typeof createIdentityStore>, client: QueryClient, accountId: string) =>
  store.subscribe(s => s.selectedId, id => {
    if (id) void client.invalidateQueries({ queryKey: ['identity-inheritance', accountId] });
  });

export const subscribeIdentityFilters = (store: ReturnType<typeof createIdentityStore>, client: QueryClient, accountId: string, scrollToHeading: () => void) =>
  store.subscribe(s => s.filters, () => {
    void client.cancelQueries({ queryKey: ['identity-options', accountId] });
    scrollToHeading();
  });
