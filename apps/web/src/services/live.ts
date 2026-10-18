import type { ApiRoomItem } from '@/lib/api';
import type { LiveRoomDetail, LiveRoomJoin, LiveRoomClose } from '@my-platform/shared';
import { APIError, check } from './api/client';

export function liveRoomService(base: string) {
  const cooldowns = new Map<string, { until: number; error: APIError }>();
  const assertReady = (scope: string) => {
    const cooldown = cooldowns.get(scope);
    if (cooldown && cooldown.until > Date.now()) {
      const { error, until } = cooldown;
      throw new APIError(error.message, error.status, error.code, until - Date.now(), error.pendingUntil);
    }
  };
  const rememberCooldown = (scope: string, error: unknown) => {
    if (!(error instanceof APIError)) return;
    const delay = Math.max(error.retryAfterMs ?? (error.status === 429 ? 60_000 : 0), (error.pendingUntil ?? 0) - Date.now());
    if (delay > 0) cooldowns.set(scope, { until: Date.now() + delay, error });
  };
  const request = async (url: string, init?: RequestInit): Promise<Response> => {
    const scope = init?.method === 'DELETE' || url === `${base}/rooms` && init?.method === 'POST' ? 'mutation' : url.endsWith('/join') || url.endsWith('/presence') ? 'join' : 'read';
    assertReady(scope);
    try { return await check(await fetch(url, init)); }
    catch (error) {
      rememberCooldown(scope, error);
      throw error;
    }
  };
  return {
    refresh: async (signal?: AbortSignal): Promise<ApiRoomItem[]> => {
      const response = await check(await request(`${base}/rooms/refresh`, { method: 'POST', signal }));
      return (await response.json()).items;
    },
    refreshDetail: async (id: string, signal?: AbortSignal): Promise<LiveRoomDetail> => {
      const response = await check(await request(`${base}/rooms/${encodeURIComponent(id)}/refresh`, { method: 'POST', signal }));
      return response.json();
    },
    detail: async (id: string, signal?: AbortSignal): Promise<LiveRoomDetail> => {
      const response = await check(await request(`${base}/rooms/${encodeURIComponent(id)}`, { cache: 'no-store', signal }));
      return response.json();
    },
    join: async (id: string, name: string, attemptId: string, signal?: AbortSignal): Promise<LiveRoomJoin> => {
      const response = await check(await request(`${base}/rooms/${encodeURIComponent(id)}/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, attemptId }), signal,
      }));
      return response.json();
    },
    confirmPresence: async (id: string, voiceToken: string, signal?: AbortSignal) => {
      await check(await request(`${base}/rooms/${encodeURIComponent(id)}/presence`, {
        method: 'POST', headers: { 'X-Live-Voice-Token': voiceToken }, signal,
      }));
    },
    list: async (signal?: AbortSignal): Promise<ApiRoomItem[]> => {
      const response = await check(await request(`${base}/rooms`, { cache: 'no-store', signal }));
      return (await response.json()).items;
    },
    create: async (title: string): Promise<{ item: ApiRoomItem; conflict?: string }> => {
      assertReady('mutation');
      const response = await fetch(`${base}/rooms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
      });
      if (response.status === 409) {
        const conflict = await response.clone().json().catch(() => null) as { error?: { code?: string; message?: string }; item?: ApiRoomItem } | null;
        if (conflict?.error?.code === 'room_already_exists' && conflict.item?.canManage) {
          return { item: conflict.item, conflict: conflict.error.message || '你已有一个直播间，请先关闭后再创建' };
        }
      }
      try { await check(response); } catch (error) {
        rememberCooldown('mutation', error);
        throw error;
      }
      return response.json();
    },
    close: async (id: string, hostIdentity?: string): Promise<LiveRoomClose> => {
      const response = await check(await request(`${base}/rooms/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostIdentity }), signal: AbortSignal.timeout(15_000) }));
      const result = await response.json();
      if (result.state !== 'closing' && result.state !== 'closed') throw new Error('结束结果尚未确认，正在核对直播间状态');
      return result;
    },
  };
}
