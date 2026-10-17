import { createIdentityStore as createCoreIdentityStore, type IdentityDependencies as CoreDependencies } from '@my-platform/client-core';
import { browserIdentityService } from '@/services/core-adapters';
export type { IdentityStore } from '@my-platform/client-core';
export type IdentityDependencies = Omit<CoreDependencies, 'service'>;
export const createIdentityStore = (dependencies: IdentityDependencies) =>
  createCoreIdentityStore({ ...dependencies, service: browserIdentityService });
