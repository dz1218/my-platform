import type { ApiRoomItem } from '@/lib/api';
export type Filter = '全部' | '直播中' | '准备中';

export type LiveLobbyState = {
  title: string;
  search: string;
  filter: Filter;
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
  search: '',
  filter: '全部',
  isCreating: false,
  closingRoomId: null,
  roomToClose: null,
  createdRoomId: null,
  error: null,
  closeError: null,
  creating: false,
});

