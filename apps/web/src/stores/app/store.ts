import { createDomainStore } from '@/stores/create-store';

export const sidebarKey = 'radio-friday:sidebar-collapsed';
export type AppStore = {
  collapsed: boolean;
  layoutReady: boolean;
  pendingHref: string | null;
  navigationId: number;
  beginNavigation: (href: string) => number;
  finishNavigation: (id: number) => void;
  cancelNavigation: () => void;
  hydrateSidebar: () => void;
  toggleSidebar: () => void;
};

// Only this layout preference is persisted. Read after hydration so the server
// and the first client render always use the same snapshot.
export function createAppStore() {
  return createDomainStore<AppStore>()((set, get) => ({
    collapsed: false,
    layoutReady: false,
    pendingHref: null,
    navigationId: 0,
    beginNavigation: href => {
      const navigationId = get().navigationId + 1;
      set({ pendingHref: href, navigationId });
      return navigationId;
    },
    finishNavigation: id => {
      if (get().navigationId === id) set({ pendingHref: null });
    },
    cancelNavigation: () => set({ pendingHref: null }),
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
