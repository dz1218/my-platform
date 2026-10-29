import { createCompanionStore as createCoreCompanionStore, type CompanionStore, type CompanionDependencies as CoreDependencies } from '@my-platform/client-core';
import { browserCompanionService } from '@/services/core-adapters';

export type { CompanionStore };
export type CompanionDependencies = Omit<CoreDependencies, 'service'>;
export function createCompanionStore(dependencies: CompanionDependencies) {
  return createCoreCompanionStore({ ...dependencies, service: browserCompanionService });
}
