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
    <main id="main-content" tabIndex={-1} className="live-page">
      <LiveLobbyClient
        apiBaseUrl="/api/v1"
        initialRooms={rooms}
        isLoggedIn={loggedIn}
        hostNickname={hostNickname}
      />
    </main>
  );
}
