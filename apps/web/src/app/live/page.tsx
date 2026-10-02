import { PageHeading } from "@/components/page-heading";
import { fetchRooms } from "@/lib/api";
import { isAuthenticated, getHostNickname } from "@/lib/auth";
import { LiveLobbyClient } from "@/components/live/live-lobby-client";

export default async function LiveLobbyPage() {
  const [rooms, loggedIn, hostNickname] = await Promise.all([
    fetchRooms(),
    isAuthenticated(),
    getHostNickname(),
  ]);

  return (
    <main id="main-content" tabIndex={-1} className="page-shell page-content">
      <PageHeading
        title="直播"
        description="看看正在发生的故事，也可以开启自己的直播。"
        actions={
          loggedIn ? (
            <span className="badge-muted min-w-0 max-w-full">
              <span className="shrink-0">主播 ·</span>
              <span className="truncate" title={hostNickname}>{hostNickname}</span>
            </span>
          ) : undefined
        }
      />

      <LiveLobbyClient
        apiBaseUrl="/api/v1"
        initialRooms={rooms}
        isLoggedIn={loggedIn}
      />
    </main>
  );
}
