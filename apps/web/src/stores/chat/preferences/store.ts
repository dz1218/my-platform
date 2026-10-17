import { createPreferencesStore as createCorePreferencesStore } from '@my-platform/client-core';
import { browserPreferencesService } from '@/services/core-adapters';
export { dailyDraftFor, type PreferencesStore } from '@my-platform/client-core';
export const createPreferencesStore = (dependencies: Omit<Parameters<typeof createCorePreferencesStore>[0], 'service'>) =>
  createCorePreferencesStore({ ...dependencies, service: browserPreferencesService });
