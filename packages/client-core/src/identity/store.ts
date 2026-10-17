import { createDomainStore } from '../create-store';
import { initialIdentityState, type IdentityState } from './initial-state';
import { createIdentityActions, type IdentityActions, type IdentityDependencies } from './actions';

export type IdentityStore = IdentityState & IdentityActions;
export function createIdentityStore(dependencies: IdentityDependencies) {
  return createDomainStore<IdentityStore>()((...args) => ({
    ...initialIdentityState(), ...createIdentityActions(dependencies)(...args),
  }));
}
