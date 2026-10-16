import { sidebarKey, type createAppStore } from './store';

export const subscribeSidebarPreference = (store: ReturnType<typeof createAppStore>) =>
  store.subscribe(s => s.collapsed, collapsed => {
    if (!store.getState().layoutReady) return;
    try { localStorage.setItem(sidebarKey, String(collapsed)); } catch { /* Persistence is optional. */ }
  });
