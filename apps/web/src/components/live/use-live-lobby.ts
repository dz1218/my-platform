'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiRoomItem } from '@/lib/api';
import { check } from '@/services/api/client';
export type LiveLobbyProps = { apiBaseUrl: string; initialRooms: ApiRoomItem[] | undefined; isLoggedIn: boolean; hostNickname: string };
export type Filter = '全部' | '直播中' | '准备中';
export function useLiveLobby({ apiBaseUrl, initialRooms, isLoggedIn, hostNickname }: LiveLobbyProps) {
  const queryClient = useQueryClient();
  const queryKey = ['live-rooms', apiBaseUrl];
  const roomsQuery = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await fetch(`${apiBaseUrl}/rooms`, { cache: 'no-store', signal });
      await check(response);
      return ((await response.json()) as { items: ApiRoomItem[] }).items;
    },
    initialData: initialRooms,
    initialDataUpdatedAt: 0,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: 5_000,
  });
  const rooms = roomsQuery.data ?? [];
  const ownedRooms = isLoggedIn ? rooms.filter((room) => room.canManage) : [];
  const ownedRoom = ownedRooms[0];
  const [title, setTitle] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('全部');
  const [isCreating, setIsCreating] = useState(false);
  const [closingRoomId, setClosingRoomId] = useState<string | null>(null);
  const [roomToClose, setRoomToClose] = useState<ApiRoomItem | null>(null);
  const [createdRoom, setCreatedRoom] = useState<ApiRoomItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const mutationPending = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const isMutating = isCreating || closingRoomId !== null;
  const liveCount = rooms.filter((room) => room.status === '直播中').length;
  const visibleRooms = rooms.filter((room) => (filter === '全部' || room.status === filter) && room.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  useEffect(() => {
    if (roomToClose) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [roomToClose]);

  async function createRoom() {
    if (mutationPending.current || roomsQuery.isPending || roomsQuery.isError) return;
    if (ownedRoom) {
      setError('你已有一个直播间，请先关闭后再创建');
      return;
    }
    const name = title.trim();
    if (!name || name.length > 100) {
      setError('请输入 1–100 个字符的房间名称');
      titleRef.current?.focus();
      return;
    }
    if (rooms.some((room) => room.title.trim().toLowerCase() === name.toLowerCase())) {
      setError('这个房间名称已被使用，请换一个名称');
      titleRef.current?.focus();
      return;
    }
    mutationPending.current = true;
    setError(null);
    setIsCreating(true);
    try {
      const response = await fetch(`${apiBaseUrl}/rooms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: name }),
      });
      if (response.status === 409) {
        const conflict = await response.clone().json().catch(() => null) as { error?: { code?: string; message?: string }; item?: ApiRoomItem } | null;
        if (conflict?.error?.code === 'room_already_exists' && conflict.item?.canManage) {
          const item = conflict.item;
          await queryClient.cancelQueries({ queryKey });
          queryClient.setQueryData<ApiRoomItem[]>(queryKey, (current = []) => [item, ...current.filter((room) => room.id !== item.id)]);
          setError(conflict.error.message || '你已有一个直播间，请先关闭后再创建');
          return;
        }
      }
      await check(response);
      const { item } = (await response.json()) as { item: ApiRoomItem };
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<ApiRoomItem[]>(queryKey, (current = []) => [item, ...current.filter((room) => room.id !== item.id)]);
      setTitle('');
      setSearch('');
      setFilter('全部');
      setCreatedRoom(item);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建房间失败，请重试');
    } finally {
      mutationPending.current = false;
      setIsCreating(false);
    }
  }

  async function closeRoom() {
    if (mutationPending.current || !roomToClose) return;
    const roomId = roomToClose.id;
    mutationPending.current = true;
    setClosingRoomId(roomId);
    setCloseError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
      await check(response);
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<ApiRoomItem[]>(queryKey, (current = []) => current.filter((room) => room.id !== roomId));
      if (createdRoom?.id === roomId) setCreatedRoom(null);
      setError(null);
      setRoomToClose(null);
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : '关闭房间失败，请重试');
    } finally {
      mutationPending.current = false;
      setClosingRoomId(null);
    }
  }

  return { roomsQuery, rooms, ownedRooms, ownedRoom, title, setTitle, search, setSearch, filter, setFilter, isCreating, closingRoomId, roomToClose, setRoomToClose, createdRoom, error, setError, closeError, setCloseError, dialogRef, titleRef, isMutating, liveCount, visibleRooms, createRoom, closeRoom, isLoggedIn, hostNickname };
}
export type LiveLobbyModel = ReturnType<typeof useLiveLobby>;
