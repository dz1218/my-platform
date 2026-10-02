import { serverFetch } from '@/services/api/server';
import { check } from '@/services/api/client';

export type ApiRoomItem = {
  id: string;
  title: string;
  status: '直播中' | '准备中';
  viewers: number;
};

export async function fetchRooms() {
  try {
    const response = await serverFetch("/rooms", {
      cache: 'no-store'
    });

    await check(response);

    const data = (await response.json()) as { items: ApiRoomItem[] };
    return data.items;
  } catch {
    // Leave the client query pending so it can retry and show an error, rather
    // than presenting an unavailable service as an empty lobby.
    return undefined;
  }
}
