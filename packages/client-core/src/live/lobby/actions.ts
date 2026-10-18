import type { QueryClient } from '@tanstack/query-core';
import type { StateCreator } from 'zustand/vanilla';
import type { ApiRoomItem, LiveUpdatesState } from '@my-platform/shared';
import type { LiveLobbyService } from '../../contracts';
import type { LiveLobbyStore } from './store';

export type LobbyDependencies = { client: QueryClient; apiBaseUrl: string; isLoggedIn: boolean; service: LiveLobbyService };
export type LobbyActions = {
  createRoom: () => Promise<'invalid-title' | undefined>;
  closeRoom: () => Promise<void>;
  refreshRooms: () => Promise<void>;
  setUpdatesState: (state: LiveUpdatesState) => void;
  setTitle: (title: string) => void;
  setRoomToClose: (room: ApiRoomItem | null) => void;
  setError: (error: string | null) => void;
  setCloseError: (error: string | null) => void;
};

type Creator = StateCreator<LiveLobbyStore, [['zustand/subscribeWithSelector', never]], [], LobbyActions>;
export const createLobbyActions = ({ client, apiBaseUrl, isLoggedIn, service }: LobbyDependencies): Creator => (set, get) => {
  const queryKey = ['live-rooms', apiBaseUrl];
  const busy = () => get().isCreating || get().closingRoomId !== null || get().isRefreshing;
  return {
    refreshRooms: async () => {
      if (busy() || !service.refresh) return;
      set({ isRefreshing: true, refreshError: null });
      await client.cancelQueries({ queryKey, exact: true });
      const revision = client.getQueryState(queryKey)?.dataUpdateCount ?? 0;
      try {
        const items = await service.refresh();
        if ((client.getQueryState(queryKey)?.dataUpdateCount ?? 0) === revision) client.setQueryData(queryKey, items);
      } catch (error) {
        if ((client.getQueryState(queryKey)?.dataUpdateCount ?? 0) === revision) set({ refreshError: error instanceof Error ? error.message : '直播间列表更新失败，请重试' });
      } finally { set({ isRefreshing: false }); }
    },
    setUpdatesState: updatesState => set({ updatesState, ...(updatesState === 'connected' ? { refreshError: null } : {}) }),
    createRoom: async () => {
      if (!isLoggedIn || busy() || client.getQueryState(queryKey)?.status !== 'success') return;
      const rooms = client.getQueryData<ApiRoomItem[]>(queryKey) ?? [];
      if (rooms.some(room => room.canManage)) { set({ error: '你已有一个直播间，请先关闭后再创建' }); return; }
      const title = get().title.trim();
      if (!title || title.length > 100) { set({ error: '请输入 1–100 个字符的房间名称' }); return 'invalid-title'; }
      if (rooms.some(room => room.title.trim().toLowerCase() === title.toLowerCase())) {
        set({ error: '这个房间名称已被使用，请换一个名称' }); return 'invalid-title';
      }
      const revision = client.getQueryState(queryKey)?.dataUpdateCount ?? 0;
      set({ isCreating: true, error: null, createdRoomId: null });
      try {
        const result = await service.create(title);
        await client.cancelQueries({ queryKey, exact: true });
        if ((client.getQueryState(queryKey)?.dataUpdateCount ?? 0) === revision) {
          client.setQueryData<ApiRoomItem[]>(queryKey, (current = []) => [result.item, ...current.filter(room => room.id !== result.item.id)]);
        }
        // A pushed snapshot may already have closed this room while its create
        // response was in flight. Check the latest cache before selecting it.
        if (!(client.getQueryData<ApiRoomItem[]>(queryKey) ?? []).some(room => room.id === result.item.id && room.canManage)) {
          set({ createdRoomId: null, error: '直播间状态已更新，请查看当前列表后重试。' });
          return;
        }
        if (result.conflict) { set({ error: result.conflict }); return; }
        set({ title: '', createdRoomId: result.item.id });
      } catch (error) { set({ error: error instanceof Error ? error.message : '创建房间失败，请重试' }); }
      finally { set({ isCreating: false }); }
    },
    closeRoom: async () => {
      const room = get().roomToClose;
      if (!isLoggedIn || busy() || !room?.canManage) return;
      set({ closingRoomId: room.id, closeError: null });
      try {
        try { await service.close(room.id); }
        catch (error) {
          const detail = await service.detail?.(room.id).catch(() => null);
          if (detail?.state === 'open') throw error;
          if (detail?.state !== 'closing' && detail?.state !== 'closed') {
            throw new Error('关闭结果尚未确认，请稍后重试。');
          }
        }
        await client.cancelQueries({ queryKey });
        client.setQueryData<ApiRoomItem[]>(queryKey, (rooms = []) => rooms.filter(item => item.id !== room.id));
        set(s => ({ createdRoomId: s.createdRoomId === room.id ? null : s.createdRoomId, error: null, roomToClose: null }));
      } catch (error) { set({ closeError: error instanceof Error ? error.message : '关闭房间失败，请重试' }); }
      finally { set({ closingRoomId: null }); }
    },
    setTitle: title => set({ title, error: null }),
    setRoomToClose: roomToClose => { if (!busy()) set({ roomToClose, closeError: null }); },
    setError: error => set({ error }),
    setCloseError: closeError => set({ closeError }),
  };
};
