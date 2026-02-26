import { webEnv } from '@/lib/env';

export type ApiRoomItem = {
  id: string;
  title: string;
  status: '直播中' | '准备中';
  viewers: number;
};

export async function fetchRooms() {
  try {
    const response = await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}/rooms`, {
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
