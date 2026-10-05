import { NextRequest } from "next/server";
import { serverOrigin, sessionCookie } from "@/services/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function matchesRequestOrigin(request: NextRequest, origin: string) {
  // NextURL normalizes loopback addresses to localhost. Use the actual Host
  // header so same-origin requests work without allowing different hosts.
  const host = request.headers.get("host") ?? request.nextUrl.host;
  try {
    return origin === new URL(`${request.nextUrl.protocol}//${host}`).origin;
  } catch {
    return false;
  }
}

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  // Only same-origin browser mutations; do not forward arbitrary incoming headers.
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && origin && !matchesRequestOrigin(request, origin)) {
    return Response.json(
      { error: { message: "请求来源不允许" } },
      { status: 403 },
    );
  }
  const headers = new Headers();
  const cookie = request.cookies.get(sessionCookie)?.value;
  if (cookie) headers.set("Cookie", `${sessionCookie}=${cookie}`);
  headers.set("Content-Type", "application/json");
  if (path[0] === "rooms" && path[2] === "voice") {
    const voiceToken = request.headers.get("x-live-voice-token");
    if (voiceToken) headers.set("X-Live-Voice-Token", voiceToken);
  }
  try {
    const body = request.method === "GET" ? undefined : await request.text();
    if (body && new TextEncoder().encode(body).length > 32 * 1024) {
      return Response.json({ error: { message: "消息过长" } }, { status: 413 });
    }
    const upstream = await fetch(
      `${serverOrigin()}/api/v1/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`,
      {
        method: request.method,
        headers,
        body,
        cache: "no-store",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      },
    );
    const output = new Headers({ "Cache-Control": "no-store" });
    for (const key of ["content-type", "set-cookie", "retry-after"]) {
      const value = upstream.headers.get(key);
      if (value) output.set(key, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: output,
    });
  } catch {
    return Response.json(
      { error: { code: "unavailable", message: "暂时连接不上，请稍后再试" } },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
