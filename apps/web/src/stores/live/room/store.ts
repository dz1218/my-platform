import { createDomainStore } from '@/stores/create-store';
import { initialLiveRoomState, type LiveRoomState } from './initial-state';
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
      const { nickname, isJoining, error, notice, isFullscreen } = get();
      set({ ...initialLiveRoomState(nickname), sessionVersion: get().sessionVersion + 1, isJoining, error, notice, isFullscreen });
    },
  }));
}
