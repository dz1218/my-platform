import type { ApiRoomItem } from '@/lib/api';

export type LiveLobbyState = {
  title: string;
  isCreating: boolean;
  closingRoomId: string | null;
  roomToClose: ApiRoomItem | null;
  createdRoomId: string | null;
  error: string | null;
  closeError: string | null;
  creating: boolean;
};

export const initialLiveLobbyState = (): LiveLobbyState => ({
  title: '',
  isCreating: false,
  closingRoomId: null,
  roomToClose: null,
  createdRoomId: null,
  error: null,
  closeError: null,
  creating: false,
});

