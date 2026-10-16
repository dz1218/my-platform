import { LiveRoomClient } from "@/components/live/live-room-client";
import { isAuthenticated, getHostNickname } from "@/lib/auth";

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
    <main id="main-content" tabIndex={-1} className="live-page live-room-page">
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
