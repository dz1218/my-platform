'use client';

import { useCurrentAccount } from '@/features/account/use-current-account';
import { LiveLobbyClient } from './live-lobby-client';
import '@/app/live/live.css';

export function LiveLobbyPage() {
  const user = useCurrentAccount();
  return <main id="main-content" tabIndex={-1} className="page-shell live-page live-lobby-page">
    <LiveLobbyClient apiBaseUrl="/api/v1" isLoggedIn={!!user} hostNickname={user?.name ?? '主播'} />
  </main>;
}
