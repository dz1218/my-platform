import { createDomainStore } from '../../create-store';
import { initialLiveRoomState, resetLiveRoomSession, type LiveRoomState } from './initial-state';
import { createRoomOperations, type RoomOperations, type RoomServices } from './slices/operations';
import { createSessionSlice, type SessionActions } from './slices/session';
import { createMediaSlice, type MediaActions } from './slices/media';

export type LiveRoomStore = LiveRoomState & SessionActions & MediaActions & RoomOperations & { resetSession: () => void };
export function createLiveRoomStore(nickname: string, services: RoomServices) {
  return createDomainStore<LiveRoomStore>()((...args) => ({
    ...initialLiveRoomState(nickname),
    ...createSessionSlice(...args),
    ...createMediaSlice(...args),
    ...createRoomOperations(services)(...args),
    resetSession: () => {
      const [set, get] = args;
      set(resetLiveRoomSession(get()));
    },
  }));
}
