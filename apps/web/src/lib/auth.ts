import { cache } from 'react';
import { cookies } from 'next/headers';
import { serverFetch, sessionCookie } from '@/services/api/server';
import type { User } from '@/types/companion';

export const getCurrentUser = cache(async (): Promise<User | null> => {
  try {
    if (!(await cookies()).get(sessionCookie)?.value) return null;
    const response = await serverFetch('/me');
    if (!response.ok) return null;
    return ((await response.json()) as { user: User }).user;
  } catch { return null; }
});
export async function isAuthenticated() { return (await getCurrentUser()) !== null; }
export async function getAuthUserId() { return (await getCurrentUser())?.id ?? null; }
export async function getHostNickname() { return (await getCurrentUser())?.name ?? '主播'; }
