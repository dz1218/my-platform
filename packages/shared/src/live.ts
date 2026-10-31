export type LiveAssistantState = {
  status: 'idle' | 'starting' | 'online' | 'stopping' | 'failed';
  sessionId?: string;
  dispatchId?: string;
  identity?: string;
  deadline?: number;
  error?: string;
};

export type ApiRoomItem = {
  id: string;
  title: string;
  status: '直播中' | '准备中';
  viewers: number;
  canManage: boolean;
};
export type LiveRoomSummary = ApiRoomItem;

export type LiveRoomDetail = {
  assistant?: LiveAssistantState;
  item: ApiRoomItem;
  state: 'open' | 'closing' | 'closed';
  reason?: 'host_left' | 'owner_closed' | 'room_finished';
  hostConnection?: 'waiting' | 'connected' | 'reconnecting';
  reconnectDeadline?: number;
};

export type LiveRoomClose = { ok: boolean; state: 'closing' | 'closed' };

export type LiveRoomJoin = {
  token: string;
  voiceToken?: string;
  role: 'host' | 'viewer';
  notice?: string;
  livekitUrl: string;
  roomId: string;
  identity: string;
};

export type LiveRoomsUpdate =
  | { type: 'rooms.updated'; items: ApiRoomItem[] }
  | { type: 'room.updated'; detail: LiveRoomDetail }
  | { type: 'room.missing'; roomId: string };
export type LiveUpdatesState = 'connecting' | 'connected' | 'reconnecting';

export const RoomConnectionState = {
  Disconnected: 'disconnected', Connecting: 'connecting', Connected: 'connected',
  Reconnecting: 'reconnecting', SignalReconnecting: 'signalReconnecting',
} as const;
export type RoomConnectionState = typeof RoomConnectionState[keyof typeof RoomConnectionState];
