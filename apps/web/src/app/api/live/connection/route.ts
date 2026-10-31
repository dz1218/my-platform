import { NextRequest } from 'next/server';
import { forwardLiveClientIP, serverOrigin, sessionCookie } from '@/services/api/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };

/** Exchange the HttpOnly session for a short-lived, read-only room socket ticket. */
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host') ?? request.nextUrl.host;
  if (origin && origin !== `${request.nextUrl.protocol}//${host}`) {
    return Response.json({ error: { message: '请求来源不允许' } }, { status: 403, headers });
  }
  const roomId = request.nextUrl.searchParams.get('roomId');
  if (roomId !== null && !/^[a-zA-Z0-9_.-]{3,128}$/.test(roomId)) {
    return Response.json({ error: { message: '直播间地址无效' } }, { status: 400, headers });
  }
  try {
    const url = new URL('/api/v1/rooms/socket', process.env.COMPANION_WS_URL || serverOrigin());
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Invalid room socket address');
    }
    url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
    const ticketURL = new URL(`${serverOrigin()}/api/v1/rooms/socket-ticket`);
    if (roomId) {
      url.searchParams.set('roomId', roomId);
      ticketURL.searchParams.set('roomId', roomId);
    }
    const upstreamHeaders = new Headers();
	const roomToken = request.headers.get('x-live-room-token');
	if (roomToken) upstreamHeaders.set('X-Live-Room-Token',roomToken);
	const after = request.nextUrl.searchParams.get('after');
	if (after && /^\d{1,18}$/.test(after)) url.searchParams.set('after', after);
    forwardLiveClientIP(request.headers, upstreamHeaders);
    const session = request.cookies.get(sessionCookie)?.value;
    if (session) upstreamHeaders.set('Cookie', `${sessionCookie}=${session}`);
    const upstream = await fetch(ticketURL, {
      method: 'POST', headers: upstreamHeaders, cache: 'no-store',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
    });
    if (!upstream.ok) {
      return Response.json({ error: { message: '暂时无法连接直播间' } }, { status: upstream.status, headers: { ...headers, ...(upstream.headers.has('Retry-After') ? { 'Retry-After': upstream.headers.get('Retry-After')! } : {}) } });
    }
    const data: unknown = await upstream.json();
    if (!data || typeof data !== 'object' || !('ticket' in data) || typeof data.ticket !== 'string' || !data.ticket) {
      throw new Error('Invalid room socket ticket');
    }
    url.searchParams.set('ticket', data.ticket);
    return Response.json({ url: url.toString() }, { headers });
  } catch {
    return Response.json({ error: { message: '暂时无法连接直播间' } }, { status: 503, headers });
  }
}
