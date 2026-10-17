import { createLiveLobbyStore as createCoreLiveLobbyStore, type LiveLobbyStore as CoreLiveLobbyStore, type LobbyDependencies as CoreDependencies } from '@my-platform/client-core';
import { liveRoomService } from '@/services/live';
import { withPresentation } from '../../with-presentation';
type LobbyPresentation = { creating: boolean; setCreating: (creating: boolean) => void };
export type LiveLobbyStore = CoreLiveLobbyStore & LobbyPresentation;
export type LobbyDependencies = Omit<CoreDependencies, 'service'> & { service?: CoreDependencies['service'] };
export function createLiveLobbyStore(dependencies: LobbyDependencies) {
  return withPresentation<CoreLiveLobbyStore, LobbyPresentation>(createCoreLiveLobbyStore({ ...dependencies, service: dependencies.service ?? liveRoomService(dependencies.apiBaseUrl) }), set => ({
    creating: false, setCreating: creating => set({ creating }),
  }));
}
