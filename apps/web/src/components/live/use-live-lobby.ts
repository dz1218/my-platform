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
export type LiveLobbyProps = { apiBaseUrl: string; isLoggedIn: boolean; hostNickname: string };
export type Filter = '全部' | '直播中' | '准备中';
export function useLiveLobby({ apiBaseUrl, isLoggedIn, hostNickname }: LiveLobbyProps) {
  const queryClient = useQueryClient();
  const service = liveRoomService(apiBaseUrl);
  const queryKey = ['live-rooms', apiBaseUrl];
  const roomsQuery = useQuery({
    ...sessionQueryOptions,
    queryKey,
    queryFn: ({ signal }) => service.list(signal),
    staleTime: 5_000,
    refetchOnMount: 'always',
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
  const rooms = roomsQuery.data ?? [];
  const ownedRooms = isLoggedIn ? rooms.filter((room) => room.canManage) : [];
  const ownedRoom = ownedRooms[0];
  const ui = useStoreInstance(() => createLiveLobbyStore({ client: queryClient, apiBaseUrl, isLoggedIn }));
  const { creating, title, isCreating, closingRoomId, roomToClose, createdRoomId, error, closeError } = useStore(ui, useShallow(liveLobbySelectors.view));
  const { setCreating, setTitle, setRoomToClose, setError, setCloseError, closeRoom } = ui.getState();
  const search = useBrowseUI(s => s.liveSearch);
  const filter = useBrowseUI(s => s.liveFilter);
  const setSearch = useBrowseUI(s => s.setLiveSearch);
  const setFilter = useBrowseUI(s => s.setLiveFilter);
  useEffect(() => ui.subscribe(s => s.createdRoomId, id => {
    if (id) { setSearch(''); setFilter('全部'); }
  }), [ui, setSearch, setFilter]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const isMutating = isCreating || closingRoomId !== null;
  const liveCount = rooms.filter((room) => room.status === '直播中').length;
  const visibleRooms = rooms.filter((room) => (filter === '全部' || room.status === filter) && room.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  useEffect(() => ui.subscribe(s => s.roomToClose, room => {
    if (room) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, { fireImmediately: true }), [ui]);

  async function createRoom() {
    if (await ui.getState().createRoom() === 'invalid-title') titleRef.current?.focus();
  }

  return { creating, setCreating, roomsQuery, rooms, ownedRooms, ownedRoom, title, setTitle, search, setSearch, filter, setFilter, isCreating, closingRoomId, roomToClose, setRoomToClose, createdRoomId, error, setError, closeError, setCloseError, dialogRef, titleRef, isMutating, liveCount, visibleRooms, createRoom, closeRoom, isLoggedIn, hostNickname };
}
export type LiveLobbyModel = ReturnType<typeof useLiveLobby>;
