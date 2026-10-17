import type { ApiRoomItem, LiveUpdatesState } from '@my-platform/shared';

export type LiveLobbyState = {
  title: string;
  isCreating: boolean;
  closingRoomId: string | null;
  roomToClose: ApiRoomItem | null;
  createdRoomId: string | null;
  error: string | null;
  closeError: string | null;
  isRefreshing: boolean;
  refreshError: string | null;
  updatesState: LiveUpdatesState;
};

export const initialLiveLobbyState = (): LiveLobbyState => ({
  title: '',
  isCreating: false,
  closingRoomId: null,
  roomToClose: null,
  createdRoomId: null,
  error: null,
  closeError: null,
  isRefreshing: false,
  refreshError: null,
  updatesState: 'connecting',
});

