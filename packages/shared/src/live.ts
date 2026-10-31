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
	roomToken: string;
	member: LiveMember;
  token: string;
  voiceToken: string;
  role: 'host' | 'viewer';
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

export type LiveRestriction = { actionId: string; until: number; reason: string };
export type LiveMember = { id: string; name: string; code: string; role: 'host' | 'viewer'; online: boolean; mute?: LiveRestriction; ban?: LiveRestriction };
export type LiveSettings = {
  rules: string; announcement: string; faq: { question: string; answer: string }[];
  blockedPhrases: string[]; slowSeconds: 0 | 5 | 10 | 30; autoReply: boolean; autoModeration: boolean; welcome: boolean;
};
export type LiveModerationAction = {
  id: string; requestId: string; memberId: string; name: string; kind: 'mute' | 'kick'; actor: string;
  reason: string; evidence: string[]; status: 'proposed' | 'pending' | 'applied' | 'failed' | 'revoked' | 'dismissed';
  until: number; createdAt: number; retryAt?: number; error?: string;
};
export type LiveModerationInput = { requestId: string; memberId?: string; kind: 'mute' | 'kick' | 'retry' | 'revoke' | 'approve' | 'dismiss'; duration?: 0 | 300 | 1800; reason?: string; actionId?: string };
export type LiveRoomMessage = { id: string; sequence: number; memberId: string; name: string; role: 'host' | 'viewer' | 'assistant' | 'system'; text: string; time: number; replyTo?: string };
export type LiveActivity = {
  type: 'room.activity'; roomId: string; roomSid: string; sequence: number; revision: number;
  members: LiveMember[]; self?: LiveMember; settings: LiveSettings; actions?: LiveModerationAction[];
  messages: LiveRoomMessage[]; removed: boolean; gap: boolean;
};
export const liveMemberLabel = (member: Pick<LiveMember, 'name' | 'code'>) => member.name.endsWith(member.code) ? member.name : `${member.name}·${member.code}`;
