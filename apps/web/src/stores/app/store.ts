import { createDomainStore } from '@/stores/create-store';

export const sidebarKey = 'radio-friday:sidebar-collapsed';
export type AppStore = {
  collapsed: boolean;
  layoutReady: boolean;
  hydrateSidebar: () => void;
  toggleSidebar: () => void;
};

// Only this layout preference is persisted. Read after hydration so the server
// and the first client render always use the same snapshot.
export function createAppStore() {
  return createDomainStore<AppStore>()((set, get) => ({
    collapsed: false,
    layoutReady: false,
    hydrateSidebar: () => {
      if (get().layoutReady) return;
      let collapsed = false;
      try { collapsed = localStorage.getItem(sidebarKey) === 'true'; } catch { /* Storage is optional. */ }
      set({ collapsed, layoutReady: true });
    },
    toggleSidebar: () => {
      const collapsed = !get().collapsed;
      set({ collapsed });
    },
  }));
}
