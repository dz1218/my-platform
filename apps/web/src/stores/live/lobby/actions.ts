import type { QueryClient } from '@tanstack/react-query';
import type { StateCreator } from 'zustand/vanilla';
import type { ApiRoomItem } from '@/lib/api';
import { liveRoomService } from '@/services/live';
import type { LiveLobbyStore } from './store';

export type LobbyDependencies = { client: QueryClient; apiBaseUrl: string; isLoggedIn: boolean; service?: ReturnType<typeof liveRoomService> };
export type LobbyActions = {
  createRoom: () => Promise<'invalid-title' | undefined>;
  closeRoom: () => Promise<void>;
  setTitle: (title: string) => void;
  setCreating: (creating: boolean) => void;
  setRoomToClose: (room: ApiRoomItem | null) => void;
  setError: (error: string | null) => void;
  setCloseError: (error: string | null) => void;
};

type Creator = StateCreator<LiveLobbyStore, [['zustand/subscribeWithSelector', never]], [], LobbyActions>;
export const createLobbyActions = ({ client, apiBaseUrl, isLoggedIn, service = liveRoomService(apiBaseUrl) }: LobbyDependencies): Creator => (set, get) => {
  const queryKey = ['live-rooms', apiBaseUrl];
  const busy = () => get().isCreating || get().closingRoomId !== null;
  const upsert = async (item: ApiRoomItem) => {
    await client.cancelQueries({ queryKey });
    client.setQueryData<ApiRoomItem[]>(queryKey, (rooms = []) => [item, ...rooms.filter(room => room.id !== item.id)]);
  };
  return {
    createRoom: async () => {
      if (!isLoggedIn || busy() || client.getQueryState(queryKey)?.status !== 'success') return;
      const rooms = client.getQueryData<ApiRoomItem[]>(queryKey) ?? [];
      if (rooms.some(room => room.canManage)) { set({ error: '你已有一个直播间，请先关闭后再创建' }); return; }
      const title = get().title.trim();
      if (!title || title.length > 100) { set({ error: '请输入 1–100 个字符的房间名称' }); return 'invalid-title'; }
      if (rooms.some(room => room.title.trim().toLowerCase() === title.toLowerCase())) {
        set({ error: '这个房间名称已被使用，请换一个名称' }); return 'invalid-title';
      }
      set({ isCreating: true, error: null });
      try {
        const result = await service.create(title);
        await upsert(result.item);
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
        await service.close(room.id);
        await client.cancelQueries({ queryKey });
        client.setQueryData<ApiRoomItem[]>(queryKey, (rooms = []) => rooms.filter(item => item.id !== room.id));
        set(s => ({ createdRoomId: s.createdRoomId === room.id ? null : s.createdRoomId, error: null, roomToClose: null }));
      } catch (error) { set({ closeError: error instanceof Error ? error.message : '关闭房间失败，请重试' }); }
      finally { set({ closingRoomId: null }); }
    },
    setTitle: title => set({ title, error: null }),
    setCreating: creating => set({ creating }),
    setRoomToClose: roomToClose => { if (!busy()) set({ roomToClose, closeError: null }); },
    setError: error => set({ error }),
    setCloseError: closeError => set({ closeError }),
  };
};
