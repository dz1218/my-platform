'use client';

import { ProfileLoading } from '@/features/account/profile-frame';
import { CompanionLoading } from '@/features/companion/companion-frame';
import { NovelShelfLoading } from '@/features/novels/novel-shelf-frame';
import { LiveLobbyLoading } from './live/live-lobby-frame';
import { LiveRoomLoading } from './live/live-room-loading';
import { ChatLoading } from '@/features/chat/chat-loading';
import { PageLoading } from './page-skeleton';

/** Render the destination's chrome before account data, without a guest owner or data requests. */
export function AccountStartupContent({ path }: { path: string }) {
  if (path === '/me') return <ProfileLoading />;
  if (path === '/companion') return <CompanionLoading />;
  if (path === '/') return <LiveLobbyLoading />;
  if (path === '/novels') return <NovelShelfLoading />;
  if (path.startsWith('/chat/')) return <ChatLoading />;
  if (path.startsWith('/live/')) return <LiveRoomLoading />;
  if (/^\/novels\/[^/]+\/chapters\/[^/]+$/.test(path)) return <PageLoading kind="reading" />;
  if (path === '/novels/create' || /\/edit$|\/manage(?:\/|$)/.test(path)) return <PageLoading kind="form" />;
  if (path.startsWith('/novels/')) return <PageLoading kind="book" />;
  if (path === '/choose-identity' || path === '/onboarding') return <PageLoading kind="identity" />;
  if (path === '/operator') return <PageLoading kind="operator" />;
  return <PageLoading />;
}
