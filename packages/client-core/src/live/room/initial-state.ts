import { RoomConnectionState as ConnectionState, type LiveUpdatesState } from '@my-platform/shared';
export type Role = '主播' | '观众';
export type ParticipantItem = { identity: string; displayName: string; role: Role | 'AI助手'; isLocal: boolean };
export type RoomJoinFailure = 'retryable' | 'in-use' | 'closed' | 'missing' | 'auth' | 'banned' | null;

export type LiveRoomState = {
  sessionVersion: number;
  role: Role | null;
  nickname: string;
  connectionState: ConnectionState;
  participants: ParticipantItem[];
  error: string | null;
  isJoining: boolean;
  joinPending: boolean;
  joinAttemptId: string | null;
  joinFailure: RoomJoinFailure;
  joinRetryAt: number;
  joinRetries: number;
  recovering: boolean;
  returnToLobby: boolean;
  closeConfirmOpen: boolean;
  isClosing: boolean;
  closeError: string | null;
  isRefreshing: boolean;
  refreshError: string | null;
  updatesState: LiveUpdatesState;
  isDispatchingAgent: boolean;
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
  nickname: nickname,
  connectionState: ConnectionState.Disconnected,
  participants: [],
  error: null,
  isJoining: true,
  joinPending: false,
  joinAttemptId: null,
  joinFailure: null,
  joinRetryAt: 0,
  joinRetries: 0,
  recovering: false,
  returnToLobby: false,
  closeConfirmOpen: false,
  isClosing: false,
  closeError: null,
  isRefreshing: false,
  refreshError: null,
  updatesState: 'connecting',
  isDispatchingAgent: false,
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
  joinAttemptId: state.joinAttemptId,
  joinFailure: state.joinFailure,
  joinRetryAt: state.joinRetryAt,
  joinRetries: state.joinRetries,
  recovering: state.recovering,
  returnToLobby: state.returnToLobby,
  closeConfirmOpen: state.closeConfirmOpen,
  isClosing: state.isClosing,
  closeError: state.closeError,
  isRefreshing: state.isRefreshing,
  refreshError: state.refreshError,
  updatesState: state.updatesState,
  error: state.error,
  notice: state.notice,
});
