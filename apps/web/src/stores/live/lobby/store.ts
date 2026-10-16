import { createDomainStore } from '@/stores/create-store';
import { initialLiveLobbyState, type LiveLobbyState } from './initial-state';
import { createLobbyActions, type LobbyActions, type LobbyDependencies } from './actions';

export type LiveLobbyStore = LiveLobbyState & LobbyActions;
export function createLiveLobbyStore(dependencies: LobbyDependencies) {
  return createDomainStore<LiveLobbyStore>()((...args) => ({
    ...initialLiveLobbyState(),
    ...createLobbyActions(dependencies)(...args),
  }));
}
