import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { replyInput, type ReplyInput } from './graph/companion.js';

export type ReplyRunner = (input: ReplyInput, signal: AbortSignal) => Promise<{ content: string; promptVersion: string; action?: string; waitSeconds?: number }>;
export function createAgentServer(token: string, run: ReplyRunner, ready = true) {
  let active = 0;
  const respond = (res: ServerResponse, status: number, body: unknown) => {
    if (res.destroyed) return;
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  return createServer({ requestTimeout: 100_000, headersTimeout: 5_000 }, async (req: IncomingMessage, res) => {
    if (req.method === 'GET' && req.url === '/health') { respond(res, ready ? 200 : 503, { ok: ready }); return; }
    const expected = Buffer.from(`Bearer ${token}`), actual = Buffer.from(req.headers.authorization ?? '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { respond(res, 401, { error: 'unauthorized' }); return; }
    if (req.method !== 'POST' || req.url !== '/internal/reply') { respond(res, 404, { error: 'not_found' }); return; }
    if (!ready) { respond(res, 503, { error: 'model_not_configured' }); return; }
    if (active >= 4) { respond(res, 503, { error: 'busy' }); return; }
    active++;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 90_000);
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk); size += buffer.length;
        if (size > 65536) { respond(res, 413, { error: 'body_too_large' }); return; }
        chunks.push(buffer);
      }
      let input: ReplyInput;
      try { input = replyInput.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { respond(res, 400, { error: 'invalid_request' }); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      res.write(': connected\n\n');
      heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 15_000);
      const reply = await run(input, abort.signal);
      if (!res.destroyed) res.end(`event: reply\ndata: ${JSON.stringify(reply)}\n\n`);
    } catch {
      // Provider errors can contain request content. Keep logs free of prompts and secrets.
      console.error('[agent] reply failed');
      if (res.headersSent) { if (!res.destroyed) res.end('event: error\ndata: {"error":"generation_failed"}\n\n'); }
      else respond(res, 502, { error: 'generation_failed' });
    } finally { clearTimeout(timer); clearInterval(heartbeat); active--; }
  });
}
