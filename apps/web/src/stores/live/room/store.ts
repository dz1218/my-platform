import { createLiveRoomStore as createCoreLiveRoomStore, resetLiveRoomSession, type LiveRoomStore as CoreLiveRoomStore, type RoomServices as CoreRoomServices } from '@my-platform/client-core';
import { browserMediaError } from '@/services/core-adapters';
import { withPresentation } from '../../with-presentation';
type RoomPresentation = {
  sideTab: 'chat' | 'people' | 'voice'; isFullscreen: boolean;
  setSideTab: (tab: RoomPresentation['sideTab']) => void;
  setIsFullscreen: (fullscreen: boolean) => void;
};
export type LiveRoomStore = CoreLiveRoomStore & RoomPresentation;
export type RoomServices = Omit<CoreRoomServices, 'mediaError'>;
export function createLiveRoomStore(nickname: string, services: RoomServices) {
  const core = createCoreLiveRoomStore(nickname, { ...services, mediaError: browserMediaError });
  return withPresentation<CoreLiveRoomStore, RoomPresentation>(core, (set, get) => ({
    sideTab: 'chat', isFullscreen: false,
    setSideTab: sideTab => set({ sideTab }),
    setIsFullscreen: isFullscreen => set({ isFullscreen }),
    resetSession: () => set({ ...resetLiveRoomSession(get()), sideTab: 'chat' }),
  }));
}
