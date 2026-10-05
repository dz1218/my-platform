import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { replyInput, type ReplyInput } from "./schemas/plan.js";
import { replyErrorCode } from "./reply-error.js";
import { assistantInput, parseAssistantReply, type AssistantInput, type AssistantReply } from "./schemas/assistant.js";

export type AssistantRunner = (input: AssistantInput, signal: AbortSignal) => Promise<AssistantReply>;

export type ReplyRunner = (
  input: ReplyInput,
  signal: AbortSignal,
) => Promise<{
  content?: string;
  messages?: { clientItemKey: string; content: string; delayMs: number }[];
  promptVersion: string;
  action?: string;
  waitSeconds?: number;
}>;
export function createAgentServer(
  token: string,
  run: ReplyRunner,
  ready = true,
  ask?: AssistantRunner,
) {
  let active = 0;
  const respond = (res: ServerResponse, status: number, body: unknown) => {
    if (res.destroyed) return;
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  return createServer(
    { requestTimeout: 100_000, headersTimeout: 5_000 },
    async (req: IncomingMessage, res) => {
      if (req.method === "GET" && req.url === "/health") {
        respond(res, ready ? 200 : 503, { ok: ready });
        return;
      }
      const expected = Buffer.from(`Bearer ${token}`),
        actual = Buffer.from(req.headers.authorization ?? "");
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      ) {
        respond(res, 401, { error: "unauthorized" });
        return;
      }
      if (
        req.method !== "POST" ||
        !["/internal/reply", "/internal/agent/generate-plan", "/internal/assistant/chat"].includes(
          req.url ?? "",
        )
      ) {
        respond(res, 404, { error: "not_found" });
        return;
      }
      const isAssistant = req.url === "/internal/assistant/chat";
      if (!ready || (isAssistant && !ask)) {
        respond(res, 503, { error: "model_not_configured" });
        return;
      }
      if (active >= 4) {
        respond(res, 503, { error: "busy" });
        return;
      }
      active++;
      const requestId = randomUUID(),
        started = Date.now();
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 90_000);
      res.on("close", () => {
        if (!res.writableEnded) abort.abort();
      });
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          const buffer = Buffer.from(chunk);
          size += buffer.length;
          if (size > (isAssistant ? 32768 : 65536)) {
            respond(res, 413, { error: "body_too_large" });
            return;
          }
          chunks.push(buffer);
        }
        let raw: unknown;
        try {
          raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          respond(res, 400, { error: "invalid_request" });
          return;
        }
        if (isAssistant && ask) {
          const parsed = assistantInput.safeParse(raw);
          if (!parsed.success) {
            respond(res, 400, { error: "invalid_request" });
            return;
          }
          const reply = await ask(parsed.data, abort.signal);
          respond(res, 200, parseAssistantReply(reply.content));
          return;
        }
        const parsed = replyInput.safeParse(raw);
        if (!parsed.success) {
          respond(res, 400, { error: "invalid_request" });
          return;
        }
        const input: ReplyInput = parsed.data;
        if (req.url === "/internal/agent/generate-plan") {
          const reply = await run(input, abort.signal);
          logReply(requestId, reply, Date.now() - started);
          respond(res, 200, reply);
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders();
        res.write(": connected\n\n");
        heartbeat = setInterval(() => {
          if (!res.destroyed) res.write(": heartbeat\n\n");
        }, 15_000);
        const reply = await run(input, abort.signal);
        logReply(requestId, reply, Date.now() - started);
        if (!res.destroyed)
          res.end(`event: reply\ndata: ${JSON.stringify(reply)}\n\n`);
      } catch (error) {
        // Provider errors can contain request content. Keep logs free of prompts and secrets.
        const code = replyErrorCode(error);
        console.error("[agent] reply failed", code);
        if (res.headersSent) {
          if (!res.destroyed)
            res.end(
              `event: error\ndata: ${JSON.stringify({ error: code })}\n\n`,
            );
        } else respond(res, isAssistant && abort.signal.aborted ? 504 : 502, {
          error: isAssistant && abort.signal.aborted ? "generation_timeout" : "generation_failed",
        });
      } finally {
        clearTimeout(timer);
        clearInterval(heartbeat);
        active--;
        console.info(
          JSON.stringify({
            event: "agent_request_finished",
            requestId,
            durationMs: Date.now() - started,
            aborted: abort.signal.aborted,
          }),
        );
      }
    },
  );
}

function logReply(requestId: string, reply: Awaited<ReturnType<ReplyRunner>>, generationMs: number) {
  console.info(JSON.stringify({
    event: "agent_plan_generated",
    requestId,
    generationMs,
    promptVersion: reply.promptVersion,
    bubbleCount: reply.messages?.length ?? 0,
    characterCount: reply.messages?.reduce((n, m) => n + [...m.content].length, 0) ?? 0,
  }));
}
