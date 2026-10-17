import type { ApiRoomItem } from '@/lib/api';
import type { LiveRoomDetail, LiveRoomJoin } from '@my-platform/shared';
import { check } from './api/client';

export function liveRoomService(base: string) {
  return {
    refresh: async (signal?: AbortSignal): Promise<ApiRoomItem[]> => {
      const response = await check(await fetch(`${base}/rooms/refresh`, { method: 'POST', signal }));
      return (await response.json()).items;
    },
    refreshDetail: async (id: string, signal?: AbortSignal): Promise<LiveRoomDetail> => {
      const response = await check(await fetch(`${base}/rooms/${encodeURIComponent(id)}/refresh`, { method: 'POST', signal }));
      return response.json();
    },
    detail: async (id: string, signal?: AbortSignal): Promise<LiveRoomDetail> => {
      const response = await check(await fetch(`${base}/rooms/${encodeURIComponent(id)}`, { cache: 'no-store', signal }));
      return response.json();
    },
    join: async (id: string, name: string, attemptId: string, signal?: AbortSignal): Promise<LiveRoomJoin> => {
      const response = await check(await fetch(`${base}/rooms/${encodeURIComponent(id)}/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, attemptId }), signal,
      }));
      return response.json();
    },
    confirmPresence: async (id: string, voiceToken: string, signal?: AbortSignal) => {
      await check(await fetch(`${base}/rooms/${encodeURIComponent(id)}/presence`, {
        method: 'POST', headers: { 'X-Live-Voice-Token': voiceToken }, signal,
      }));
    },
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
