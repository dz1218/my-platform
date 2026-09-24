import { NextRequest } from 'next/server';
import { serverOrigin, sessionCookie } from '@/services/api/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  // Only same-origin browser mutations; do not forward arbitrary incoming headers.
  const origin = request.headers.get('origin');
  if (request.method !== 'GET' && origin && origin !== request.nextUrl.origin) {
    return Response.json({ error: { message: '请求来源不允许' } }, { status: 403 });
  }
  const headers = new Headers();
  const cookie = request.cookies.get(sessionCookie)?.value;
  if (cookie) headers.set('Cookie', `${sessionCookie}=${cookie}`);
  headers.set('Content-Type', 'application/json');
  try {
    const body = request.method === 'GET' ? undefined : await request.text();
    if (body && new TextEncoder().encode(body).length > 32 * 1024) {
      return Response.json({ error: { message: '消息过长' } }, { status: 413 });
    }
    const upstream = await fetch(`${serverOrigin()}/api/v1/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`, {
      method: request.method, headers, body, cache: 'no-store', signal: request.signal,
    });
    const output = new Headers({ 'Cache-Control': 'no-store, no-transform' });
    for (const key of ['content-type', 'set-cookie', 'retry-after', 'x-accel-buffering']) {
      const value = upstream.headers.get(key);
      if (value) output.set(key, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: output });
  } catch {
    return Response.json({ error: { code: 'unavailable', message: '暂时连接不上，请稍后再试' } }, { status: 503 });
  }
}
export { proxy as GET, proxy as POST };
