import { randomUUID } from "node:crypto";
import type { RoomAsk, RoomTurn } from "./agents/room-assistant.js";

export const roomChatTopic = "live-chat.v1";
type Author = { identity: string; name: string; isAgent?: boolean };
type Question = { author: Author; text: string };
type Pair = [RoomTurn, RoomTurn];

// Wire limits match the existing browser chat. Avoid cutting a surrogate pair.
export function boundReply(text: string) {
  const value = text.trim();
  if (value.length <= 500) return value;
  return value.slice(0, 499).replace(/[\uD800-\uDBFF]$/, "") + "…";
}

export function createRoomChat({ ask, publish, timeoutMs = 30_000, now = Date.now }: {
  ask: RoomAsk;
  publish: (payload: Uint8Array, destination?: string) => Promise<void>;
  timeoutMs?: number;
  now?: () => number;
}) {
  const history: Pair[] = [], queue: Question[] = [];
  const pending = new Set<string>(), seen = new Map<string, number>(), notices = new Map<string, number>();
  let closed = false, running = false, abort: AbortController | undefined;
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const send = async (text: string, destination?: string) => {
    if (!closed) await publish(encoder.encode(JSON.stringify({ v: 1, id: randomUUID(), text: boundReply(text) })), destination);
  };
  const notice = (author: Author, text: string) => {
    if ((notices.get(author.identity) ?? -Infinity) + 5_000 > now()) return;
    if (notices.size >= 2000) notices.delete(notices.keys().next().value!);
    notices.set(author.identity, now());
    void send(text, author.identity).catch(() => {});
  };
  async function drain() {
    if (running || closed) return;
    running = true;
    try {
      while (queue.length && !closed) {
        const question = queue.shift()!;
        const input: RoomTurn = { role: "user", content: JSON.stringify({ participantId: question.author.identity, name: question.author.name.slice(0, 80), question: question.text }) };
        const context = history.flat();
        while (context.length && context.reduce((n, m) => n + m.content.length, input.content.length) > 16_000) context.splice(0, 2);
        abort = new AbortController();
        const signal = abort.signal;
        const timer = setTimeout(() => abort?.abort(), timeoutMs);
        let onAbort: () => void = () => {};
        try {
          const cancelled = new Promise<never>((_, reject) => {
            onAbort = () => reject(new Error("cancelled"));
            signal.addEventListener("abort", onAbort, { once: true });
          });
          const answer = boundReply(await Promise.race([ask([...context, input], signal), cancelled]));
          clearTimeout(timer); // The deadline bounds generation, not room delivery.
          if (!answer) throw new Error("empty_response");
          if (closed || signal.aborted) continue;
          await send(answer);
          if (closed || signal.aborted) continue;
          history.push([input, { role: "assistant", content: answer }]);
          while (history.length > 20 || history.flat().reduce((n, m) => n + m.content.length, 0) > 16_000) history.shift();
        } catch {
          if (!closed) await send(signal.aborted ? "回答超时了，请稍后重新 @AI 提问。" : "这次没能回答，请稍后重新 @AI 提问。", question.author.identity).catch(() => {});
        } finally {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          abort = undefined;
          pending.delete(question.author.identity);
        }
      }
    } finally { running = false; }
  }
  return {
    receive(payload: Uint8Array, author: Author) {
      if (closed || author.isAgent || !author.identity || payload.byteLength > 4096) return;
      let data: { v?: unknown; id?: unknown; text?: unknown };
      try { data = JSON.parse(decoder.decode(payload)); } catch { return; }
      if (!data || data.v !== 1 || typeof data.id !== "string" || !data.id || data.id.length > 80 || typeof data.text !== "string" || data.text.length > 500) return;
      const match = /^@AI(?:\s+|[，,:：]|$)/i.exec(data.text.trim());
      if (!match) return;
      const key = JSON.stringify([author.identity, data.id]);
      for (const [id, at] of seen) if (now() - at > 600_000) seen.delete(id);
      if (seen.has(key)) return;
      if (seen.size >= 2000) seen.delete(seen.keys().next().value!);
      seen.set(key, now());
      const text = data.text.trim().slice(match[0].length).trim();
      if (!text) { notice(author, "在 @AI 后写下你的问题吧。"); return; }
      if (pending.has(author.identity)) { notice(author, "你的上一个问题还在处理中，请稍等。"); return; }
      if (queue.length >= 5) { notice(author, "现在提问较多，请稍后重试。"); return; }
      pending.add(author.identity);
      queue.push({ author, text });
      void drain();
    },
    close() { closed = true; abort?.abort(); queue.length = 0; history.length = 0; pending.clear(); seen.clear(); notices.clear(); },
  };
}
