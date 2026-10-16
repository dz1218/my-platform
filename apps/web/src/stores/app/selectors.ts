import type { AppStore } from './store';

export const appSelectors = {
  collapsed: (s: AppStore) => s.collapsed,
  layoutReady: (s: AppStore) => s.layoutReady,
};
