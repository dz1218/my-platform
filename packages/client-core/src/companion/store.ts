import { createDomainStore } from '../create-store';
import { initialCompanionState, type CompanionState } from './initial-state';
import { createCompanionActions, type CompanionActions, type CompanionDependencies } from './actions';

export type CompanionStore = CompanionState & CompanionActions;
export function createCompanionStore(dependencies: CompanionDependencies) {
  return createDomainStore<CompanionStore>()((...args) => ({
    ...initialCompanionState(), ...createCompanionActions(dependencies)(...args),
  }));
}
