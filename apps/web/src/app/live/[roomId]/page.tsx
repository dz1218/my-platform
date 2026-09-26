import Link from 'next/link';
import { LiveRoomClient } from '@/components/live/live-room-client';
import { webEnv } from '@/lib/env';
import { isAuthenticated, getHostNickname } from '@/lib/auth';

export default async function LiveRoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const [{ roomId }, loggedIn, hostNickname] = await Promise.all([
    params,
    isAuthenticated(),
    getHostNickname(),
  ]);

  return (
    <main id="main-content" tabIndex={-1} className="page-shell page-content">
      <div className="mb-6">
        <Link href="/live" className="link-muted inline-flex items-center gap-1.5">
          <svg aria-hidden="true"
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
          直播大厅
        </Link>
      </div>

      <div className="mb-5 flex items-center gap-3">
        <div className="badge-live">
          <span className="live-dot h-[7px] w-[7px]" />
          <span>LIVE</span>
        </div>
        <h1 className="m-0 truncate text-[22px] font-semibold tracking-[-0.3px] text-slate-900">{roomId}</h1>
        {loggedIn && (
          <span className="shrink-0 rounded-md border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
            主播模式
          </span>
        )}
      </div>

      <LiveRoomClient
        apiBaseUrl={webEnv.NEXT_PUBLIC_API_BASE_URL}
        roomId={roomId}
        isLoggedIn={loggedIn}
        hostNickname={hostNickname}
      />
    </main>
  );
}
