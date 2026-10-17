import { NextRequest } from 'next/server';
import { serverOrigin, sessionCookie } from '@/services/api/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };

/** Exchange the HttpOnly session for a short-lived, path-scoped private socket ticket. */
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host') ?? request.nextUrl.host;
  if (origin && origin !== `${request.nextUrl.protocol}//${host}`) {
    return Response.json({ error: { message: '请求来源不允许' } }, { status: 403, headers });
  }
  const kind = request.nextUrl.searchParams.get('kind');
  const id = request.nextUrl.searchParams.get('conversationId');
  if (kind !== 'matches' && (kind !== 'conversation' || !id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) {
    return Response.json({ error: { message: '连接地址无效' } }, { status: 400, headers });
  }
  const path = kind === 'matches' ? '/api/v1/matches' : `/api/v1/conversations/${encodeURIComponent(id!)}`;
  try {
    const url = new URL(`${path}/socket`, process.env.COMPANION_WS_URL || serverOrigin());
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Invalid socket address');
    }
    url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
    const ticketURL = new URL(`${serverOrigin()}${path}/socket-ticket`);
    const upstreamHeaders = new Headers();
    const session = request.cookies.get(sessionCookie)?.value;
    if (session) upstreamHeaders.set('Cookie', `${sessionCookie}=${session}`);
    const upstream = await fetch(ticketURL, {
      method: 'POST', headers: upstreamHeaders, cache: 'no-store',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
    });
    if (!upstream.ok) {
      return Response.json({ error: { message: '暂时无法建立实时连接' } }, { status: upstream.status, headers });
    }
    const data: unknown = await upstream.json();
    if (!data || typeof data !== 'object' || !('ticket' in data) || typeof data.ticket !== 'string' || !data.ticket) {
      throw new Error('Invalid room socket ticket');
    }
    url.searchParams.set('ticket', data.ticket);
    return Response.json({ url: url.toString() }, { headers });
  } catch {
    return Response.json({ error: { message: '暂时无法建立实时连接' } }, { status: 503, headers });
  }
}
