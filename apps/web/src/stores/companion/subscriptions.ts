import type { QueryClient } from '@tanstack/react-query';
import type { createCompanionStore } from './store';

export const subscribeCompanionFilters = (store: ReturnType<typeof createCompanionStore>, client: QueryClient, accountId: string | null, scrollToHeading: () => void) =>
  store.subscribe(s => s.filters, (_filters, previous) => {
    void client.cancelQueries({ queryKey: ['discover', accountId, previous] });
    scrollToHeading();
  });
