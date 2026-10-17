import { RoomConnectionState as ConnectionState } from '@my-platform/shared';
export type Role = '主播' | '观众';
export type ParticipantItem = { identity: string; displayName: string; role: Role | 'AI助手'; isLocal: boolean };

export type LiveRoomState = {
  sessionVersion: number;
  role: Role | null;
  roomNotice: string;
  nickname: string;
  connectionState: ConnectionState;
  participants: ParticipantItem[];
  error: string | null;
  isJoining: boolean;
  isDispatchingAgent: boolean;
  agentRequested: boolean;
  voiceToken: string;
  notice: string;
  mediaBusy: 'camera' | 'microphone' | null;
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  audioBlocked: boolean;
};
export const initialLiveRoomState = (nickname = ''): LiveRoomState => ({
  sessionVersion: 0,
  role: null,
  roomNotice: '',
  nickname: nickname,
  connectionState: ConnectionState.Disconnected,
  participants: [],
  error: null,
  isJoining: true,
  isDispatchingAgent: false,
  agentRequested: false,
  voiceToken: '',
  notice: '',
  mediaBusy: null,
  cameraEnabled: false,
  microphoneEnabled: false,
  audioBlocked: false,
});

/** Reset session-owned permissions and media while retaining rejoin feedback. */
export const resetLiveRoomSession = (state: LiveRoomState): LiveRoomState => ({
  ...initialLiveRoomState(state.nickname),
  sessionVersion: state.sessionVersion + 1,
  isJoining: state.isJoining,
  error: state.error,
  notice: state.notice,
});
