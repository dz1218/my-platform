import "server-only";
import { isIP } from 'node:net';
import { cookies, headers as requestHeaders } from "next/headers";

export const sessionCookie = "companion_session";
export const serverOrigin = () =>
  process.env.COMPANION_API_URL ?? "http://127.0.0.1:8080";

// Use only a single IP header overwritten by a verified ingress. The Go API
// must also trust this server's peer CIDR. Never forward browser XFF by default.
export function forwardLiveClientIP(incoming: Pick<Headers, 'get'>, outgoing: Headers) {
  const name = process.env.LIVE_TRUSTED_CLIENT_IP_HEADER;
  const clientIP = name ? incoming.get(name)?.trim() : undefined;
  if (clientIP && isIP(clientIP)) outgoing.set('X-Forwarded-For', clientIP);
}

export async function serverFetch(path: string, init: RequestInit = {}) {
  const store = await cookies();
  const headers = new Headers(init.headers);
  const token = store.get(sessionCookie)?.value;
  if (token) headers.set("Cookie", `${sessionCookie}=${token}`);
  if (path === '/rooms' || path.startsWith('/rooms/')) forwardLiveClientIP(await requestHeaders(), headers);
  return fetch(`${serverOrigin()}/api/v1${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(10_000),
  });
}
