'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiRoomItem } from '@/lib/api';
import { check } from '@/services/api/client';

type Props = {
  apiBaseUrl: string;
  initialRooms: ApiRoomItem[] | undefined;
  isLoggedIn: boolean;
};

export function LiveLobbyClient({ apiBaseUrl, initialRooms, isLoggedIn }: Props) {
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
  const [title, setTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [closingRoomId, setClosingRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutationPending = useRef(false);
  const isMutating = isCreating || closingRoomId !== null;

  async function createRoom() {
    if (mutationPending.current) return;
    mutationPending.current = true;
    setError(null);
    setIsCreating(true);
    try {
      const response = await fetch(`${apiBaseUrl}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() || undefined }),
      });
      await check(response);
      const { item } = (await response.json()) as { item: ApiRoomItem };
      // Ignore any list request that started before the mutation completed.
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<ApiRoomItem[]>(queryKey, (current = []) => [
        item, ...current.filter((room) => room.id !== item.id),
      ]);
      setTitle('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建房间失败');
    } finally {
      mutationPending.current = false;
      setIsCreating(false);
    }
  }

  async function closeRoom(roomId: string) {
    if (mutationPending.current) return;
    if (!window.confirm("确定关闭这个直播间吗？")) return;
    mutationPending.current = true;
    setClosingRoomId(roomId);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
      await check(response);
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<ApiRoomItem[]>(queryKey, (current = []) =>
        current.filter((room) => room.id !== roomId),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '关闭房间失败');
    } finally {
      mutationPending.current = false;
      setClosingRoomId(null);
    }
  }

  const isLive = (room: ApiRoomItem) => room.status === '直播中';

  return (
    <>
      {isLoggedIn ? (
        <section className="surface mb-4 p-4 sm:p-5">
          <form className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center" onSubmit={(event) => {
            event.preventDefault();
            void createRoom();
          }}>
            <label htmlFor="room-title" className="text-sm font-semibold sm:pr-3">创建直播间</label>
            <input
              id="room-title"
              name="roomTitle" aria-label="直播间标题" autoComplete="off"
              maxLength={100}
              disabled={isMutating}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
              }}
              placeholder="输入直播间标题（可选）"
              className="input-field min-w-0 flex-1"
            />
            <button
              type="submit"
              disabled={isMutating}
              className="btn-primary min-w-[80px] px-5"
            >
              {isCreating ? '创建中…' : '创建'}
            </button>
          </form>

          {error && (
            <div role="alert" className="mt-3.5 flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3.5 py-2.5">
              <svg aria-hidden="true"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 shrink-0"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <p className="m-0 text-[13px] leading-6 text-rose-700">{error}</p>
            </div>
          )}
        </section>
      ) : (
        <div className="surface mb-4 flex items-center gap-3 px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-slate-200 bg-white">
            <svg aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[13px] font-semibold text-slate-600">观众模式</p>
            <p className="mt-0.5 text-xs text-slate-500">
              选择一个直播间进入观看，或{' '}
              <Link href="/login" className="text-brand-600 no-underline hover:text-brand-400">
                主播登录
              </Link>{' '}
              后创建房间
            </p>
          </div>
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between px-1">
          <span aria-live="polite" className="text-[13px] font-medium text-slate-500">
            {`直播间 · ${rooms.length}`}
          </span>
          <button type="button" className="btn-link" disabled={roomsQuery.isFetching || isMutating} onClick={() => void roomsQuery.refetch()}>
            {roomsQuery.isFetching ? '更新中…' : '刷新列表'}
          </button>
        </div>

        {roomsQuery.isError && (
          <p role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            直播间列表更新失败，{roomsQuery.error.message}。可点击“刷新列表”重试。
          </p>
        )}
        {roomsQuery.isPending ? (
          <div role="status" className="empty-state">正在加载直播间…</div>
        ) : rooms.length === 0 && !roomsQuery.isError ? (
          <div className="empty-state">
            <p className="mb-1.5 text-[15px] font-semibold text-slate-600">暂无直播间</p>
            <p className="m-0 text-[13px] leading-6 text-slate-500">
              {isLoggedIn ? '在上方填写标题，创建你的第一个直播间。' : '现在还没有人开播，过会儿再来看看。'}
            </p>
          </div>
        ) : (
          <div className="collection-grid">
            {rooms.map((room) => {
              const live = isLive(room);
              const roomIconTone = live
                ? 'border-live-500/30 bg-rose-50'
                : 'border-slate-200 bg-white';
              const statusTone = live
                ? 'border-live-500/30 bg-live-500/[0.15] text-live-300'
                : 'border-slate-200 bg-white text-slate-500';

              return (
                <article key={room.id} aria-label={room.title} className="surface-soft room-card grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3.5 p-4">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${roomIconTone}`}>
                    {live ? (
                      <span className="live-dot h-2.5 w-2.5" />
                    ) : (
                      <svg aria-hidden="true"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="2" y="7" width="20" height="15" rx="2" />
                        <polyline points="17 2 12 7 7 2" />
                      </svg>
                    )}
                  </div>

                  <Link href={`/live/${encodeURIComponent(room.id)}`} className="min-w-0 no-underline text-inherit">
                    <div className="flex flex-wrap items-center gap-2">
                      <span title={room.title} className="w-full truncate text-[15px] font-bold text-slate-900">{room.title}</span>
                      <span className={`shrink-0 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${statusTone}`}>
                        {room.status}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <svg aria-hidden="true"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
                      </svg>
                      <span className="text-xs text-slate-500">{room.viewers} 人在房间</span>
                    </div>
                  </Link>

                  <div className="col-span-2 flex items-center justify-between gap-3 border-t border-line pt-3">
                  <Link
                    href={`/live/${encodeURIComponent(room.id)}`}
                    className="btn-secondary min-w-0 text-brand-600 no-underline"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {isLoggedIn ? '进入直播间' : '观看'}
                      <svg aria-hidden="true"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </span>
                  </Link>

                  {isLoggedIn && (
                    <button
                      type="button"
                      onClick={() => void closeRoom(room.id)}
                      disabled={isMutating}
                      aria-label={`关闭直播间：${room.title}`}
                      className="btn-danger-ghost shrink-0 rounded-lg px-3 py-2"
                    >
                      <svg aria-hidden="true"
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                      {closingRoomId === room.id ? '关闭中…' : '关闭'}
                    </button>
                  )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
