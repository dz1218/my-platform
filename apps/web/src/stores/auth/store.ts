import { createDomainStore } from '@/stores/create-store';
import { initialAuthFormState, type AuthFormState } from './initial-state';
import { createAuthActions, type AuthFormActions, type AuthFormServices } from './actions';

export type AuthFormStore = AuthFormState & AuthFormActions;
export function createAuthFormStore(services: AuthFormServices) {
  return createDomainStore<AuthFormStore>()((...args) => ({
    ...initialAuthFormState(),
    ...createAuthActions(services)(...args),
  }));
}
