import { RoomConnectionState as ConnectionState } from '@my-platform/shared';
import { liveRoomSelectors as coreSelectors } from '@my-platform/client-core/live/room';
import type { LiveRoomStore } from './store';
export const liveRoomSelectors = {
  view: (s: LiveRoomStore) => ({
    ...coreSelectors.view(s),
    sideTab: s.sideTab,
    isFullscreen: s.isFullscreen,
  }),
  isConnected: (s: LiveRoomStore) => s.connectionState === ConnectionState.Connected,
  isReconnecting: (s: LiveRoomStore) => s.connectionState === ConnectionState.Reconnecting || s.connectionState === ConnectionState.SignalReconnecting,
  hasAgent: (s: LiveRoomStore) => s.participants.some(p => p.role === 'AI助手'),
};
