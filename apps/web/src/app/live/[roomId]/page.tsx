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
    <main id="main-content" tabIndex={-1} className="live-page live-room-page">
      <LiveRoomClient
        key={roomId}
        apiBaseUrl="/api/v1"
        roomId={roomId}
        isLoggedIn={loggedIn}
        hostNickname={hostNickname}
        roomTitle={room?.title ?? '直播间'}
      />
    </main>
  );
}
