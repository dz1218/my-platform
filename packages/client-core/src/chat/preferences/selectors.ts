import type { PreferencesStore } from './store';

export const preferencesSelectors = {
  view: (s: PreferencesStore) => ({
    error: s.error,
    notice: s.notice,
    busy: s.busy,
  }),
};

