export type ApiRoomItem = {
  id: string;
  title: string;
  status: '直播中' | '准备中';
  viewers: number;
  canManage: boolean;
};
export type LiveRoomSummary = ApiRoomItem;

export const RoomConnectionState = {
  Disconnected: 'disconnected', Connecting: 'connecting', Connected: 'connected',
  Reconnecting: 'reconnecting', SignalReconnecting: 'signalReconnecting',
} as const;
export type RoomConnectionState = typeof RoomConnectionState[keyof typeof RoomConnectionState];
