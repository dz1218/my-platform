'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createAppStore, type AppStore } from './app';
import { createChatStore, type ChatStore } from './chat';
import { useStoreInstance } from './use-store-instance';
import { subscribeSidebarPreference } from './app/subscriptions';
import { createBrowseStore, type BrowseState } from './browse';

function createStores() {
  return { app: createAppStore(), chat: createChatStore(), browse: createBrowseStore() };
}
const StoresContext = createContext<ReturnType<typeof createStores> | null>(null);

/** Root Providers is keyed by account ID, so account changes drop all drafts. */
export function ClientStoresProvider({ children }: { children: ReactNode }) {
  const stores = useStoreInstance(createStores);
  useEffect(() => subscribeSidebarPreference(stores.app), [stores]);
  return <StoresContext.Provider value={stores}>{children}</StoresContext.Provider>;
}

function useStores() {
  const stores = useContext(StoresContext);
  if (!stores) throw new Error('ClientStoresProvider is required');
  return stores;
}

export function useAppUI<T>(selector: (state: AppStore) => T) {
  return useStore(useStores().app, selector);
}

export function useChatUI<T>(selector: (state: ChatStore) => T) {
  return useStore(useStores().chat, selector);
}

export function useBrowseUI<T>(selector: (state: BrowseState) => T) {
  return useStore(useStores().browse, selector);
}
