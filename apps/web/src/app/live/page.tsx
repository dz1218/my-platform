import Link from 'next/link';
import { fetchRooms } from '@/lib/api';
import { webEnv } from '@/lib/env';
import { isAuthenticated, getHostNickname } from '@/lib/auth';
import { LiveLobbyClient } from '@/components/live/live-lobby-client';

export default async function LiveLobbyPage() {
  const [rooms, loggedIn, hostNickname] = await Promise.all([
    fetchRooms(),
    isAuthenticated(),
    getHostNickname(),
  ]);

  return (
    <main className="mx-auto max-w-[900px] px-6 pb-16 pt-10">
      <div className="mb-7">
        <Link href="/" className="link-muted inline-flex items-center gap-1.5">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          首页
        </Link>
      </div>

      <div className="mb-8 flex flex-wrap items-center justify-between gap-3.5">
        <div className="flex items-center gap-3.5">
          <div className="icon-chip-live h-[42px] w-[42px] rounded-xl">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#F43F5E"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="7" width="20" height="15" rx="2" />
              <polyline points="17 2 12 7 7 2" />
            </svg>
          </div>
          <div>
            <h1 className="m-0 text-[26px] font-extrabold tracking-[-0.5px] text-slate-100">直播大厅</h1>
            <p className="mt-0.5 text-[13px] text-slate-500">
              {loggedIn ? '以主播身份登录' : '以观众身份浏览'}
            </p>
          </div>
        </div>

        {loggedIn ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3.5 py-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-400/[0.35] bg-gradient-to-br from-emerald-400/30 to-emerald-400/[0.15] text-xs font-extrabold text-emerald-400">
              {(hostNickname[0] ?? '主').toUpperCase()}
            </div>
            <span className="text-[13px] font-semibold text-emerald-300">{hostNickname}</span>
          </div>
        ) : null}
      </div>

      <LiveLobbyClient
        apiBaseUrl={webEnv.NEXT_PUBLIC_API_BASE_URL}
        initialRooms={rooms}
        isLoggedIn={loggedIn}
      />
    </main>
  );
}
