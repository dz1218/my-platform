'use client';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useStoreInstance } from '@/stores/use-store-instance';
import { createLiveLobbyStore, liveLobbySelectors } from '@/stores/live/lobby';
import { useBrowseUI } from '@/stores/provider';
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { liveRoomService } from '@/services/live';
import { sessionQueryOptions } from '@/services/query-options';
import { RoomsConnection } from '@/services/rooms-connection';
import { createLiveRoomUpdates } from '@my-platform/client-core';
export type LiveLobbyProps = { apiBaseUrl: string; isLoggedIn: boolean; hostNickname: string };
export type Filter = '全部' | '直播中' | '准备中';
export function useLiveLobby({ apiBaseUrl, isLoggedIn, hostNickname }: LiveLobbyProps) {
  const queryClient = useQueryClient();
  const service = useStoreInstance(() => liveRoomService(apiBaseUrl));
  const refreshRequestRef = useRef<AbortController | null>(null);
  const queryKey = ['live-rooms', apiBaseUrl];
  const roomsQuery = useQuery({
    ...sessionQueryOptions,
    queryKey,
    queryFn: ({ signal }) => service.list(signal),
    refetchOnMount: 'always',
  });
  const rooms = roomsQuery.data ?? [];
  const ownedRooms = isLoggedIn ? rooms.filter((room) => room.canManage) : [];
  const ownedRoom = ownedRooms[0];
  const ui = useStoreInstance(() => createLiveLobbyStore({ client: queryClient, apiBaseUrl, isLoggedIn, service: {
    ...service,
    detail: id => service.detail(id, AbortSignal.timeout(10_000)),
    refresh: async () => {
      const controller = new AbortController();
      refreshRequestRef.current = controller;
      try { return await service.refresh(controller.signal); }
      finally { if (refreshRequestRef.current === controller) refreshRequestRef.current = null; }
    },
  } }));
  const { creating, title, isCreating, closingRoomId, roomToClose, createdRoomId, error, closeError, isRefreshing, refreshError, updatesState } = useStore(ui, useShallow(liveLobbySelectors.view));
  const { setCreating, setTitle, setRoomToClose, setError, setCloseError, closeRoom, refreshRooms } = ui.getState();
  const listError = refreshError ?? roomsQuery.error?.message;
  const updatesLabel = updatesState === 'connected' ? '实时更新' : updatesState === 'reconnecting' ? '重新连接中…' : '正在连接实时更新…';
  useEffect(() => {
    const updates = createLiveRoomUpdates(queryClient, apiBaseUrl);
    const connection = new RoomsConnection({
      onUpdate: event => { void updates.receive(event); },
      onState: ui.getState().setUpdatesState,
    });
    return () => { updates.close(); connection.close(); refreshRequestRef.current?.abort(); };
  }, [queryClient, apiBaseUrl, ui]);
  const search = useBrowseUI(s => s.liveSearch);
  const filter = useBrowseUI(s => s.liveFilter);
  const setSearch = useBrowseUI(s => s.setLiveSearch);
  const setFilter = useBrowseUI(s => s.setLiveFilter);
  useEffect(() => ui.subscribe(s => s.createdRoomId, id => {
    if (id) { setSearch(''); setFilter('全部'); }
  }), [ui, setSearch, setFilter]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const isMutating = isCreating || closingRoomId !== null || isRefreshing;
  const liveCount = rooms.filter((room) => room.status === '直播中').length;
  const visibleRooms = rooms.filter((room) => (filter === '全部' || room.status === filter) && room.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  useEffect(() => ui.subscribe(s => s.roomToClose, room => {
    if (room) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, { fireImmediately: true }), [ui]);

  async function createRoom() {
    if (await ui.getState().createRoom() === 'invalid-title') titleRef.current?.focus();
  }

  return { creating, setCreating, roomsQuery, rooms, ownedRooms, ownedRoom, title, setTitle, search, setSearch, filter, setFilter, isCreating, closingRoomId, roomToClose, setRoomToClose, createdRoomId, error, setError, closeError, setCloseError, dialogRef, titleRef, isMutating, liveCount, visibleRooms, createRoom, closeRoom, refreshRooms, isRefreshing, listError, updatesLabel, isLoggedIn, hostNickname };
}
export type LiveLobbyModel = ReturnType<typeof useLiveLobby>;
