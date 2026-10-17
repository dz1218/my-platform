import { createCompanionStore as createCoreCompanionStore, type CompanionStore as CoreCompanionStore, type CompanionDependencies as CoreDependencies } from '@my-platform/client-core';
import { browserCompanionService } from '@/services/core-adapters';
import { withPresentation } from '../with-presentation';
import type { CompanionTab } from './initial-state';
type CompanionPresentation = { initialTab: CompanionTab | null; initializeTab: (recentCount: number) => void };
export type CompanionDependencies = Omit<CoreDependencies, 'service'>;
export type CompanionStore = CoreCompanionStore & CompanionPresentation;
export function createCompanionStore(dependencies: CompanionDependencies) {
  return withPresentation<CoreCompanionStore, CompanionPresentation>(createCoreCompanionStore({ ...dependencies, service: browserCompanionService }), (set, get) => ({
    initialTab: null,
    initializeTab: recentCount => { if (!get().initialTab) set({ initialTab: recentCount ? 'recent' : 'discover' }); },
  }));
}
