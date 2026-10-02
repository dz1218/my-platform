import Link from "next/link";
import { LiveRoomClient } from "@/components/live/live-room-client";
import { isAuthenticated, getHostNickname } from "@/lib/auth";
import { fetchRooms } from "@/lib/api";

export default async function LiveRoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const [{ roomId }, loggedIn, hostNickname, rooms] = await Promise.all([
    params,
    isAuthenticated(),
    getHostNickname(),
    fetchRooms(),
  ]);
  const room = rooms?.find((item) => item.id === roomId);

  return (
    <main id="main-content" tabIndex={-1} className="page-shell page-content">
      <div className="mb-6">
        <Link
          href="/live"
          className="link-muted inline-flex items-center gap-1.5"
        >
          <svg
            aria-hidden="true"
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
        <span className="badge-muted shrink-0">直播间</span>
        <h1 className="m-0 truncate text-[22px] font-semibold tracking-[-0.3px] text-slate-900">
          {room?.title ?? '直播间'}
        </h1>
        {loggedIn && (
          <span className="shrink-0 rounded-md border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
            主播模式
          </span>
        )}
      </div>

      <LiveRoomClient
        key={roomId}
        apiBaseUrl="/api/v1"
        roomId={roomId}
        isLoggedIn={loggedIn}
        hostNickname={hostNickname}
      />
    </main>
  );
}
