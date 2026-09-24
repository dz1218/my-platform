import 'server-only';
import { cookies } from 'next/headers';

export const sessionCookie = 'companion_session';
export const serverOrigin = () => process.env.COMPANION_API_URL ?? 'http://127.0.0.1:8080';

export async function serverFetch(path: string, init: RequestInit = {}) {
  const store = await cookies();
  const headers = new Headers(init.headers);
  const token = store.get(sessionCookie)?.value;
  if (token) headers.set('Cookie', `${sessionCookie}=${token}`);
  return fetch(`${serverOrigin()}/api/v1${path}`, {
    ...init, headers, cache: 'no-store', signal: init.signal ?? AbortSignal.timeout(10_000),
  });
}
