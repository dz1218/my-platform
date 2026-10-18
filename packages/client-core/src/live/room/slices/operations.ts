import { RoomConnectionState as ConnectionState, type ApiRoomItem, type LiveRoomDetail, type LiveRoomJoin, type LiveRoomClose, type LiveUpdatesState } from '@my-platform/shared';
import type { QueryClient } from '@tanstack/query-core';
import type { StateCreator } from 'zustand/vanilla';
import type { LiveRoomStore } from '../store';

import type { MediaErrorMessage } from '../../../contracts';
type Device = 'camera' | 'microphone';
type MediaSnapshot = { cameraEnabled: boolean; microphoneEnabled: boolean };
export type RoomOperations = {
  joinSession: (connect: (joined: LiveRoomJoin) => Promise<void>, isCancelled?: () => boolean) => Promise<boolean>;
  handleHostDisconnected: () => void;
  cancelJoinRecovery: () => void;
  requestLobbyReturn: () => boolean;
  setCloseConfirmOpen: (open: boolean) => void;
  endRoom: () => Promise<boolean>;
  refreshRoom: () => Promise<void>;
  setUpdatesState: (state: LiveUpdatesState) => void;
  dispatchAgent: () => Promise<void>;
  toggleMedia: (device: Device, control: () => Promise<MediaSnapshot | null>) => Promise<void>;
};
export type RoomServices = {
  dispatch: () => Promise<void>;
  mediaError: MediaErrorMessage;
  session?: { join: (name: string, attemptId: string) => Promise<LiveRoomJoin>; createAttemptId: () => string; canRetryBusy?: () => boolean };
  close?: () => Promise<LiveRoomClose | void>;
  detail?: () => Promise<LiveRoomDetail>;
  refresh?: () => Promise<LiveRoomDetail>;
  query?: { client: QueryClient; apiBaseUrl: string; roomId: string };
};
export const createRoomOperations = (services: RoomServices): StateCreator<LiveRoomStore, [['zustand/subscribeWithSelector', never]], [], RoomOperations> => (set, get) => ({
  refreshRoom: async () => {
    if (!services.refresh || !services.query || get().isRefreshing || get().isClosing) return;
    const { client, apiBaseUrl, roomId } = services.query;
    const queryKey = ['live-room', apiBaseUrl, roomId];
    set({ isRefreshing: true, refreshError: null });
    await client.cancelQueries({ queryKey, exact: true });
    const revision = client.getQueryState(queryKey)?.dataUpdateCount ?? 0;
    try {
      const detail = await services.refresh();
      if ((client.getQueryState(queryKey)?.dataUpdateCount ?? 0) === revision) client.setQueryData(queryKey, detail);
    } catch (error) {
      if ((client.getQueryState(queryKey)?.dataUpdateCount ?? 0) === revision) set({ refreshError: error instanceof Error ? error.message : '直播间状态更新失败，请重试' });
    } finally { set({ isRefreshing: false }); }
  },
  setUpdatesState: updatesState => set({ updatesState, ...(updatesState === 'connected' ? { refreshError: null } : {}) }),
  joinSession: async (connect, isCancelled = () => false) => {
    const s = get();
    if (!services.session || s.joinPending || (s.joinFailure && s.joinFailure !== 'retryable' && !(s.joinFailure === 'in-use' && (s.recovering || services.session.canRetryBusy?.())))) return false;
    const version = s.sessionVersion;
    const current = () => !isCancelled() && get().sessionVersion === version;
    const attemptId = s.joinAttemptId ?? services.session.createAttemptId();
    const name = s.nickname.trim() || '观众';
    set({ joinPending: true, isJoining: true, joinAttemptId: attemptId, joinFailure: null, joinRetryAt: 0, error: null });
    try {
      const joined = await services.session.join(name, attemptId);
      if (!current()) return false;
      if (joined.role !== 'host' && joined.role !== 'viewer') throw new Error('暂时无法确认房间身份，请稍后重新加入。');
      set({ role: joined.role === 'host' ? '主播' : '观众', nickname: name, roomNotice: joined.notice || '', voiceToken: joined.voiceToken || '' });
      await connect(joined);
      if (!current()) return false;
      set({ joinAttemptId: null, joinRetryAt: 0, joinRetries: 0, recovering: false });
      return true;
    } catch (error) {
      if (!current()) return false;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
      const joinFailure = code === 'host_session_in_use' ? 'in-use' : code === 'room_closed' || status === 410 ? 'closed' : code === 'room_not_found' || status === 404 ? 'missing' : status === 401 || status === 403 || status === 400 ? 'auth' : 'retryable';
      const message = joinFailure === 'in-use' ? '你已在另一个页面或设备进入此直播间，请使用原页面继续直播。'
        : joinFailure === 'closed' ? '直播间已结束，请返回直播大厅。'
          : joinFailure === 'missing' ? '直播间已关闭或不存在。'
            : error instanceof Error ? error.message : '加入房间失败';
      const meta = error as { retryAfterMs?: number; pendingUntil?: number } | null;
      const tries = get().joinRetries + 1;
      const retryable = joinFailure === 'retryable' || (joinFailure === 'in-use' && (s.recovering || services.session.canRetryBusy?.()) && tries <= 12);
      const delay = Math.max(Math.min(1000 * 2 ** Math.min(tries - 1, 3), 5000) + Math.random() * 250, meta?.retryAfterMs ?? 0, (meta?.pendingUntil ?? 0) - Date.now());
      set({ joinRetries: tries, joinRetryAt: retryable ? Date.now() + delay : 0, joinFailure, error: message.toLowerCase().includes('could not establish pc connection') ? '暂时无法连接直播，请检查网络后重新加入。' : message });
      return false;
    } finally {
      if (current()) set({ joinPending: false, isJoining: false });
    }
  },
  handleHostDisconnected: () => {
    if (get().isClosing || get().joinFailure === 'closed') return;
    set({ recovering: true, joinFailure: 'retryable', joinRetryAt: Date.now() + 1000, joinAttemptId: null, isJoining: false, error: '连接暂时中断，正在自动恢复，设备将保持关闭。' });
  },
  cancelJoinRecovery: () => set({ joinRetryAt: 0, joinRetries: 0, recovering: false }),
  requestLobbyReturn: () => {
    const s = get();
    if (s.isClosing) return false;
    if (s.role === '主播') {
      set({ returnToLobby: true, closeConfirmOpen: true, closeError: null });
      return false;
    }
    if (s.isJoining && !s.joinFailure) { set({ notice: '正在确认房间身份，请稍候…' }); return false; }
    return true;
  },
  setCloseConfirmOpen: (closeConfirmOpen) => {
    const s = get();
    if (s.isClosing || (closeConfirmOpen && s.role !== '主播')) return;
    set({ closeConfirmOpen, closeError: null, returnToLobby: false });
  },
  endRoom: async () => {
    const s = get();
    if (!services.close || s.role !== '主播' || !s.closeConfirmOpen || s.isClosing) return false;
    set({ isClosing: true, closeError: null });
    try {
      let result: LiveRoomClose | void;
      try { result = await services.close(); }
      catch (error) {
        // A lost DELETE response says nothing about whether the intent was
        // accepted. Read the durable state before allowing navigation/retry.
        const detail = await services.detail?.().catch(() => null);
        if (detail?.state === 'closing' || detail?.state === 'closed') result = { ok: true, state: detail.state };
        else if (detail?.state === 'open') throw error;
        else throw new Error('结束结果尚未确认，请稍后重试；确认前将停留在当前页面。');
      }
      // Prefer a newer pushed terminal snapshot if the DELETE response was lost.
      const closedState = result?.state ?? 'closed';
      if (services.query) {
        const { client, apiBaseUrl, roomId } = services.query;
        const detailKey = ['live-room', apiBaseUrl, roomId];
        const listKey = ['live-rooms', apiBaseUrl];
        await client.cancelQueries({ queryKey: detailKey });
        client.setQueryData<LiveRoomDetail>(detailKey, current => current ? { ...current, state: closedState, reason: 'owner_closed' } : current);
        await client.cancelQueries({ queryKey: listKey });
        client.setQueryData<ApiRoomItem[]>(listKey, rooms => rooms?.filter(room => room.id !== roomId));
        void client.invalidateQueries({ queryKey: listKey });
      }
      set({ closeConfirmOpen: false, joinFailure: 'closed', joinRetryAt: 0, recovering: false, isJoining: false });
      return true;
    } catch (error) {
      set({ closeError: error instanceof Error ? error.message : '结束直播失败，请重试' });
      return false;
    } finally {
      set({ isClosing: false });
    }
  },
  dispatchAgent: async () => {
    const s = get();
    if (s.role !== '主播' || s.connectionState !== ConnectionState.Connected || s.isDispatchingAgent || s.agentRequested || s.participants.some(p => p.role === 'AI助手')) return;
    const version = s.sessionVersion;
    set({ isDispatchingAgent: true, error: null });
    try {
      await services.dispatch();
      if (get().sessionVersion === version) set({ agentRequested: true });
    } catch (error) {
      if (get().sessionVersion === version) set({ error: error instanceof Error ? error.message : '派发 AI 助手失败' });
    } finally {
      if (get().sessionVersion === version) set({ isDispatchingAgent: false });
    }
  },
  toggleMedia: async (device, control) => {
    const s = get();
    if (s.role !== '主播' || s.connectionState !== ConnectionState.Connected || s.mediaBusy) return;
    const version = s.sessionVersion;
    set({ mediaBusy: device, error: null });
    try {
      const media = await control();
      if (media && get().sessionVersion === version) set(media);
    } catch (error) {
      if (get().sessionVersion === version) set({ error: services.mediaError(error, device) });
    } finally {
      if (get().sessionVersion === version) set({ mediaBusy: null });
    }
  },
});
