import { fetchRooms } from "@/lib/api";
import { isAuthenticated, getHostNickname } from "@/lib/auth";
import { LiveLobbyClient } from "@/components/live/live-lobby-client";
import { Suspense } from 'react';
import { LiveLobbySkeleton } from '@/components/live/live-lobby-skeleton';

export default function LiveLobbyPage() {
  return <main id="main-content" tabIndex={-1} className="page-shell live-page">
    <Suspense fallback={<LiveLobbySkeleton />}><LobbyData /></Suspense>
  </main>;
}

async function LobbyData() {
  const [{ rooms, updatedAt }, loggedIn, hostNickname] = await Promise.all([
    fetchRooms().then(rooms => ({ rooms, updatedAt: Date.now() })),
    isAuthenticated(),
    getHostNickname(),
  ]);

  return (
      <LiveLobbyClient
        apiBaseUrl="/api/v1"
        initialRooms={rooms}
        initialRoomsUpdatedAt={updatedAt}
        isLoggedIn={loggedIn}
        hostNickname={hostNickname}
      />
  );
}
