import type { ApiRoomItem } from '@/lib/api';
import { check } from './api/client';

export function liveRoomService(base: string) {
  return {
    list: async (signal?: AbortSignal): Promise<ApiRoomItem[]> => {
      const response = await check(await fetch(`${base}/rooms`, { cache: 'no-store', signal }));
      return (await response.json()).items;
    },
    create: async (title: string): Promise<{ item: ApiRoomItem; conflict?: string }> => {
      const response = await fetch(`${base}/rooms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
      });
      if (response.status === 409) {
        const conflict = await response.clone().json().catch(() => null) as { error?: { code?: string; message?: string }; item?: ApiRoomItem } | null;
        if (conflict?.error?.code === 'room_already_exists' && conflict.item?.canManage) {
          return { item: conflict.item, conflict: conflict.error.message || '你已有一个直播间，请先关闭后再创建' };
        }
      }
      await check(response);
      return response.json();
    },
    close: async (id: string) => {
      await check(await fetch(`${base}/rooms/${encodeURIComponent(id)}`, { method: 'DELETE' }));
    },
  };
}
