'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ApiRoomItem } from '@/lib/api';
import { logoutAction } from '@/lib/actions';

type Props = {
  apiBaseUrl: string;
  initialRooms: ApiRoomItem[];
  isLoggedIn: boolean;
};

export function LiveLobbyClient({ apiBaseUrl, initialRooms, isLoggedIn }: Props) {
  const [rooms, setRooms] = useState(initialRooms);
  const [title, setTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshRooms() {
    const response = await fetch(`${apiBaseUrl}/rooms`);
    if (!response.ok) throw new Error(`拉取房间失败: ${response.status}`);
    const data = (await response.json()) as { items: ApiRoomItem[] };
    setRooms(data.items);
  }

  async function createRoom() {
    setError(null);
    setIsCreating(true);
    try {
      const response = await fetch(`${apiBaseUrl}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() || undefined }),
      });
      if (!response.ok) throw new Error(`创建房间失败: ${response.status}`);
      setTitle('');
      await refreshRooms();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建房间失败');
    } finally {
      setIsCreating(false);
    }
  }

  async function closeRoom(roomId: string) {
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/rooms/${roomId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`关闭房间失败: ${response.status}`);
      await refreshRooms();
    } catch (err) {
      setError(err instanceof Error ? err.message : '关闭房间失败');
    }
  }

  const isLive = (room: ApiRoomItem) => room.status === '直播中';

  return (
    <>
      {isLoggedIn ? (
        <section className="glass-card mb-4 p-6">
          <div className="mb-[18px] flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <div className="icon-chip-brand h-8 w-8 rounded-lg bg-gradient-to-br from-brand-500 to-violet-500">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </div>
              <h2 className="m-0 text-base font-bold text-slate-100">创建直播间</h2>
            </div>

            <form action={logoutAction}>
              <button type="submit" className="btn-danger-ghost rounded-lg px-3 py-[7px] text-xs">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                退出登录
              </button>
            </form>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isCreating && void createRoom()}
              placeholder="输入直播间标题（可选）"
              className="input-glass min-w-[260px] flex-1"
            />
            <button
              type="button"
              onClick={() => void createRoom()}
              disabled={isCreating}
              className="btn-indigo min-w-[104px] px-5"
            >
              {isCreating ? '创建中...' : '创建'}
            </button>
          </div>

          {error && (
            <div className="mt-3.5 flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3.5 py-2.5">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#FCA5A5"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 shrink-0"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <p className="m-0 text-[13px] leading-6 text-rose-300">{error}</p>
            </div>
          )}
        </section>
      ) : (
        <div className="glass-card mb-4 flex items-center gap-3 px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-white/10 bg-white/[0.06]">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#64748B"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[13px] font-semibold text-slate-400">观众模式</p>
            <p className="mt-0.5 text-xs text-slate-600">
              选择一个直播间进入观看，或{' '}
              <Link href="/login" className="text-brand-300 no-underline hover:text-brand-400">
                主播登录
              </Link>{' '}
              后创建房间
            </p>
          </div>
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between px-1">
          <span className="text-[13px] font-medium text-slate-500">
            {rooms.length > 0 ? `${rooms.length} 个直播间` : '暂无直播间'}
          </span>
        </div>

        {rooms.length === 0 ? (
          <div className="glass-card-soft px-6 py-[52px] text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06]">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#64748B"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="7" width="20" height="15" rx="2" />
                <polyline points="17 2 12 7 7 2" />
              </svg>
            </div>
            <p className="mb-1.5 text-[15px] font-semibold text-slate-400">暂无直播间</p>
            <p className="m-0 text-[13px] leading-6 text-slate-600">
              {isLoggedIn ? '请确认 API 与 LiveKit 已启动，或在上方创建一个。' : '请确认 API 与 LiveKit 已启动。'}
            </p>
          </div>
        ) : (
          <div className="grid gap-2.5">
            {rooms.map((room) => {
              const live = isLive(room);
              const roomIconTone = live
                ? 'border-live-500/30 bg-gradient-to-br from-live-500/25 to-live-500/10'
                : 'border-white/10 bg-white/[0.06]';
              const statusTone = live
                ? 'border-live-500/30 bg-live-500/[0.15] text-live-300'
                : 'border-white/10 bg-white/[0.06] text-slate-500';

              return (
                <div key={room.id} className="glass-card-soft room-card flex items-center gap-3.5 px-[18px] py-4">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${roomIconTone}`}>
                    {live ? (
                      <span className="live-dot h-2.5 w-2.5" />
                    ) : (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#64748B"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="2" y="7" width="20" height="15" rx="2" />
                        <polyline points="17 2 12 7 7 2" />
                      </svg>
                    )}
                  </div>

                  <Link href={`/live/${room.id}`} className="min-w-0 flex-1 no-underline text-inherit">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[15px] font-bold text-slate-100">{room.title}</span>
                      <span className={`shrink-0 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${statusTone}`}>
                        {room.status}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#64748B"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
                      </svg>
                      <span className="text-xs text-slate-500">{room.viewers} 人观看</span>
                    </div>
                  </Link>

                  <Link
                    href={`/live/${room.id}`}
                    className="shrink-0 rounded-lg border border-brand-400/[0.35] bg-brand-500/[0.15] px-3.5 py-2 text-[13px] font-semibold text-brand-300 no-underline transition-colors hover:bg-brand-500/25"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {isLoggedIn ? '进入（主播）' : '观看'}
                      <svg
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
                      className="btn-danger-ghost rounded-lg px-3 py-2"
                    >
                      <svg
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
                      关闭
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
