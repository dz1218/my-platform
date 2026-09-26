import { PageHeading } from '@/components/page-heading';
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
    <main id="main-content" tabIndex={-1} className="page-shell page-content">
      <PageHeading title="直播" description="看看正在发生的故事，也可以开启自己的直播。" actions={loggedIn ? <span className="badge-muted">主播 · {hostNickname}</span> : undefined} />

      <LiveLobbyClient
        apiBaseUrl={webEnv.NEXT_PUBLIC_API_BASE_URL}
        initialRooms={rooms}
        isLoggedIn={loggedIn}
      />
    </main>
  );
}
