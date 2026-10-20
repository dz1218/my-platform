'use client';

import { useLayoutEffect } from 'react';
import { useAuthExit } from '@/features/auth/auth-exit-transition';
import { useAppUI } from '@/stores/provider';
import { useViewport } from '@/components/use-viewport';
import { useCurrentAccount } from '@/features/account/use-current-account';
import { LiveLobbyClient } from './live-lobby-client';
import '@/app/live/live.css';

export function LiveLobbyPage() {
  const user = useCurrentAccount();
  const viewport = useViewport();
  const layoutReady = useAppUI(s => s.layoutReady);
  const { onHomeReady } = useAuthExit();
  useLayoutEffect(() => {
    if (viewport && layoutReady) onHomeReady();
  }, [viewport, layoutReady, onHomeReady]);
  return <main id="main-content" tabIndex={-1} className="page-shell live-page live-lobby-page">
    <LiveLobbyClient apiBaseUrl="/api/v1" isLoggedIn={!!user} hostNickname={user?.name ?? '主播'} />
  </main>;
}
