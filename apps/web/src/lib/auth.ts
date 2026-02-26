import { cookies } from 'next/headers';
import crypto from 'node:crypto';

function getSecret(): string {
  return process.env.AUTH_SECRET ?? 'dev_fallback_secret_change_me';
}

/** Create a tamper-proof session token: `${userId}|${hmac}` */
export function signUserId(userId: string): string {
  const mac = crypto.createHmac('sha256', getSecret()).update(userId).digest('hex');
  return `${userId}|${mac}`;
}

/** Verify the token and return the userId, or null if invalid */
export function verifyToken(token: string): string | null {
  const idx = token.indexOf('|');
  if (idx === -1) return null;
  const userId = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const expected = crypto.createHmac('sha256', getSecret()).update(userId).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex'))) {
      return null;
    }
  } catch {
    return null;
  }
  return userId;
}

export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  const token = store.get('mp_auth')?.value;
  if (!token) return false;
  return verifyToken(token) !== null;
}

export async function getAuthUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get('mp_auth')?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function getHostNickname(): Promise<string> {
  const store = await cookies();
  return store.get('mp_nickname')?.value ?? '主播';
}
