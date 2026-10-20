import { LiveLobbyLoading } from '@/components/live/live-lobby-frame';

// Keep the lobby fallback inside this route group, away from auth navigation.
export default function Loading() {
  return <LiveLobbyLoading />;
}
