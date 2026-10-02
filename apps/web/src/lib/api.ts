import { serverFetch } from '@/services/api/server';

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

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as { items: ApiRoomItem[] };
    return data.items;
  } catch {
    return [];
  }
}
