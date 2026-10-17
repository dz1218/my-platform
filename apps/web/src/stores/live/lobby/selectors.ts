import type { LiveLobbyStore } from './store';

export const liveLobbySelectors = {
  view: (s: LiveLobbyStore) => ({
    title: s.title,
    isCreating: s.isCreating,
    closingRoomId: s.closingRoomId,
    roomToClose: s.roomToClose,
    createdRoomId: s.createdRoomId,
    error: s.error,
    closeError: s.closeError,
    isRefreshing: s.isRefreshing,
    refreshError: s.refreshError,
    updatesState: s.updatesState,
    creating: s.creating,
  }),
};

