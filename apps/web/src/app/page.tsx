import Link from 'next/link';
import { webEnv } from '@/lib/env';
import { isAuthenticated, getHostNickname } from '@/lib/auth';
import { logoutAction } from '@/lib/actions';

type HealthResponse = {
  ok: boolean;
  service: string;
};

async function getApiHealth() {
  try {
    const response = await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}/health`, {
      cache: 'no-store',
    });
    if (!response.ok) return false;
    const data = (await response.json()) as HealthResponse;
    return data.ok;
  } catch {
    return false;
  }
}

export default async function Home() {
  const [isApiUp, loggedIn, hostNickname] = await Promise.all([
    getApiHealth(),
    isAuthenticated(),
    getHostNickname(),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 pb-24 pt-20">
      <div className="mb-16 text-center">
        <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-[18px] bg-gradient-to-br from-brand-500 to-violet-500 shadow-brand-glow">
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0" />
            <circle cx="12" cy="20" r="1" fill="white" stroke="none" />
          </svg>
        </div>

        <h1 className="mb-4 bg-gradient-to-br from-slate-100 via-indigo-200 to-violet-300 bg-clip-text text-[42px] font-extrabold leading-[1.15] tracking-[-1px] text-transparent">
          My Platform
        </h1>
        <p className="mx-auto mb-7 max-w-xl text-base leading-7 text-slate-400">
          直播 · 小说 · AI 驱动的下一代内容平台
        </p>

        <div
          className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 ${
            isApiUp
              ? 'border-emerald-400/30 bg-emerald-400/10'
              : 'border-rose-400/30 bg-rose-400/10'
          }`}
        >
          <span
            className={
              isApiUp
                ? 'online-dot'
                : 'inline-block h-2 w-2 flex-none rounded-full bg-rose-500'
            }
          />
          <span
            className={`text-[13px] font-semibold tracking-[0.02em] ${
              isApiUp ? 'text-emerald-300' : 'text-rose-300'
            }`}
          >
            API {isApiUp ? '在线' : '离线'}
          </span>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Link href="/live" className="block h-full no-underline text-inherit">
          <div className="glass-card nav-card h-full p-8">
            <div className="mb-5 flex h-[52px] w-[52px] items-center justify-center rounded-[14px] border border-live-500/30 bg-gradient-to-br from-live-500/25 to-live-500/10">
              <svg
                width="24"
                height="24"
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

            <div className="mb-3 flex items-center gap-2.5">
              <h2 className="m-0 text-xl font-bold text-slate-100">直播大厅</h2>
              <span className="rounded-md border border-live-500/30 bg-live-500/[0.15] px-2 py-0.5 text-[10px] font-bold tracking-[0.08em] text-live-500">
                LIVE
              </span>
            </div>

            <p className="mb-5 text-sm leading-7 text-slate-400">
              查看直播间列表，以主播或观众身份进入房间，支持 AI 助手陪播。
            </p>

            <div className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-live-300">
              进入直播
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
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </Link>

        <Link href="/novels" className="block h-full no-underline text-inherit">
          <div className="glass-card nav-card h-full p-8">
            <div className="mb-5 flex h-[52px] w-[52px] items-center justify-center rounded-[14px] border border-violet-400/30 bg-gradient-to-br from-violet-500/25 to-violet-500/10">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#A78BFA"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
              </svg>
            </div>

            <h2 className="mb-3 text-xl font-bold text-slate-100">小说</h2>
            <p className="mb-5 text-sm leading-7 text-slate-400">
              章节管理与阅读入口，沉浸式阅读体验，精品内容持续更新。
            </p>

            <div className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-violet-300">
              探索内容
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
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </Link>
      </div>

      <div className="mt-14 text-center">
        {loggedIn ? (
          <div className="inline-flex items-center gap-2.5">
            <span className="text-xs text-slate-600">
              已以主播身份登录：<span className="text-slate-500">{hostNickname}</span>
            </span>
            <form action={logoutAction} className="inline">
              <button type="submit" className="btn-link">
                退出登录
              </button>
            </form>
          </div>
        ) : (
          <div className="inline-flex items-center gap-3">
            <Link href="/login" className="text-xs text-slate-600 no-underline transition-colors hover:text-slate-400">
              登录
            </Link>
            <span className="text-xs text-slate-800">·</span>
            <Link
              href="/register"
              className="text-xs text-slate-600 no-underline transition-colors hover:text-slate-400"
            >
              注册
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
