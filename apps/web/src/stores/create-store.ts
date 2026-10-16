import { createStore, type StateCreator } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';

/** Every domain supports selective imperative subscriptions as well as React selectors. */
export const createDomainStore = <T>() => (
  creator: StateCreator<T, [['zustand/subscribeWithSelector', never]], []>,
) => createStore<T>()(subscribeWithSelector(creator));
