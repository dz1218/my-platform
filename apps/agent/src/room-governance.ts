import { randomUUID } from "node:crypto";
import { z } from "zod";

const messageSchema = z.object({
  id: z.string(),
  sequence: z.number(),
  memberId: z.string(),
  name: z.string(),
  role: z.enum(["host", "viewer", "assistant", "system"]),
  text: z.string(),
  time: z.number(),
  replyTo: z.string().optional(),
});
export const roomHistoryPageSchema = z.object({
  messages: z.array(messageSchema),
  nextBefore: z.number().nullable(),
});
export type RoomHistoryQuery = {
  query: string | null;
  member: string | null;
  before: number | null;
  limit: number;
  through: number;
};
export type RoomHistoryReader = (
  query: RoomHistoryQuery,
  signal: AbortSignal,
) => Promise<z.infer<typeof roomHistoryPageSchema>>;
export const roomActivitySchema = z.object({
  roomId: z.string(),
  roomSid: z.string(),
  sessionId: z.string(),
  title: z.string(),
  sequence: z.number(),
  assistantStartedAt: z.number(),
  settings: z.object({
    rules: z.string(),
    announcement: z.string(),
    faq: z.array(z.object({ question: z.string(), answer: z.string() })),
    blockedPhrases: z.array(z.string()),
    slowSeconds: z.number(),
    autoReply: z.boolean(),
    autoModeration: z.boolean(),
    welcome: z.boolean(),
  }),
  members: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      code: z.string(),
      role: z.enum(["host", "viewer"]),
      online: z.boolean(),
      mute: z.unknown().optional(),
      ban: z.unknown().optional(),
    }),
  ),
  messages: z.array(messageSchema),
});
export type RoomActivity = z.infer<typeof roomActivitySchema>;
export type RoomPublicMessage = z.infer<typeof messageSchema>;
export type RoomAssistantInput = {
  title: string;
  sequence: number;
  settings: RoomActivity["settings"];
  messages: RoomPublicMessage[];
  candidates: RoomPublicMessage[];
  explicit: boolean;
};
export type RoomAssistantDecision = {
  reply: string | null;
  sourceId: string | null;
};
export type RoomAssistantOutput = {
  requestId: string;
  kind: "reply" | "notice" | "welcome" | "suggest";
  text: string;
  sourceId?: string;
  memberId?: string;
  actionKind?: "mute" | "kick";
};
type Task = { messages: RoomPublicMessage[]; priority: number };
export function createGovernedRoomChat({
  decide,
  output,
  batchMs = 2000,
  timeoutMs = 30000,
  now = Date.now,
}: {
  decide: (
    input: RoomAssistantInput,
    signal: AbortSignal,
  ) => Promise<RoomAssistantDecision>;
  output: (output: RoomAssistantOutput) => Promise<unknown>;
  batchMs?: number;
  timeoutMs?: number;
  now?: () => number;
}) {
  let latest: RoomActivity | undefined,
    closed = false,
    running = false,
    sequence = 0,
    autoAt = -Infinity;
  let batch: ReturnType<typeof setTimeout> | undefined,
    welcome: ReturnType<typeof setTimeout> | undefined,
    abort: AbortController | undefined;
  const history: RoomPublicMessage[] = [],
    queue: Task[] = [],
    ordinary: RoomPublicMessage[] = [],
    pending = new Set<string>(),
    userAt = new Map<string, number>(),
    seenMembers = new Set<string>(),
    newMembers = new Set<string>(),
    notices = new Map<string, number>();
  const emit = (body: Omit<RoomAssistantOutput, "requestId">) =>
    closed
      ? Promise.resolve()
      : output({
          ...body,
          text: boundReply(body.text),
          requestId: randomUUID(),
        });
  const notice = (m: RoomPublicMessage, text: string) => {
    if ((notices.get(m.memberId) ?? -Infinity) + 5000 > now()) return;
    notices.set(m.memberId, now());
    void emit({ kind: "notice", sourceId: m.id, text }).catch(() => {});
  };
  const drain = async () => {
    if (running || closed) return;
    running = true;
    try {
      while (queue.length && !closed) {
        queue.sort((a, b) => b.priority - a.priority);
        const task = queue.shift()!;
        const snapshot = latest!;
        const candidates = task.messages.filter(
          (m) =>
            !snapshot.members.some(
              (p) => p.id === m.memberId && (p.mute || p.ban),
            ),
        );
        if (!candidates.length) {
          if (task.priority > 0)
            task.messages.forEach((m) => pending.delete(m.memberId));
          continue;
        }
        const candidateIds = new Set(candidates.map((m) => m.id));
        const context = history.filter((m) => !candidateIds.has(m.id));
        const contextSize = () =>
          [...context, ...candidates].reduce(
            (n, m) => n + JSON.stringify(m).length,
            0,
          );
        while (
          context.length &&
          (context.length + candidates.length > 100 || contextSize() > 16000)
        )
          context.shift();
        while (candidates.length > 1 && contextSize() > 16000)
          candidates.shift();
        abort = new AbortController();
        const signal = abort.signal;
        let rejectAbort: () => void = () => {};
        const timer = setTimeout(() => abort?.abort(), timeoutMs);
        try {
          const cancelled = new Promise<never>((_, reject) => {
            rejectAbort = () => reject(new Error("timeout"));
            signal.addEventListener("abort", rejectAbort, { once: true });
          });
          const result = await Promise.race([
            decide(
              {
                title: snapshot.title,
                sequence: snapshot.sequence,
                settings: snapshot.settings,
                messages: context,
                candidates,
                explicit: task.priority > 0,
              },
              signal,
            ),
            cancelled,
          ]);
          clearTimeout(timer);
          if (closed || signal.aborted || !result.reply || !result.sourceId)
            continue;
          const source = candidates.find((m) => m.id === result.sourceId);
          if (!source) continue;
          if (
            task.priority === 0 &&
            (!latest?.settings.autoReply ||
              now() - autoAt < 30000 ||
              now() - (userAt.get(source.memberId) ?? -Infinity) < 60000)
          )
            continue;
          await emit({
            kind: "reply",
            sourceId: source.id,
            text: result.reply,
          });
          if (task.priority === 0) {
            autoAt = now();
            userAt.set(source.memberId, now());
          }
        } catch {
          if (task.priority > 0 && !closed)
            notice(
              candidates[0],
              signal.aborted
                ? "回答超时了，请稍后重新 @AI 提问。"
                : "这次没能回答，请稍后重新 @AI 提问。",
            );
        } finally {
          clearTimeout(timer);
          signal.removeEventListener("abort", rejectAbort);
          abort = undefined;
          if (task.priority > 0)
            task.messages.forEach((m) => pending.delete(m.memberId));
        }
      }
    } finally {
      running = false;
    }
  };
  const flush = () => {
    batch = undefined;
    if (!ordinary.length || closed) return;
    const messages = ordinary.splice(0);
    if (queue.length < 5) {
      queue.push({ messages, priority: 0 });
      void drain();
    }
  };
  return {
    receive(value: RoomActivity) {
      if (closed) return;
      const initial = !latest;
      latest = value;
      if (!value.settings.welcome) newMembers.clear();
      for (const m of value.members) {
        if (
          value.settings.welcome &&
          !seenMembers.has(m.id) &&
          !initial &&
          m.role === "viewer"
        )
          newMembers.add(m.id);
        seenMembers.add(m.id);
      }
      if (value.settings.welcome && newMembers.size && !welcome) {
        welcome = setTimeout(() => {
          welcome = undefined;
          if (closed || !latest?.settings.welcome) {
            newMembers.clear();
            return;
          }
          const names = latest.members
            .filter((m) => newMembers.has(m.id) && m.online)
            .map((m) => m.name);
          newMembers.clear();
          if (names.length)
            void emit({
              kind: "welcome",
              text: `欢迎 ${names.slice(0, 5).join("、")}${names.length > 5 ? " 等新朋友" : ""} 来到直播间。`,
            }).catch(() => {});
        }, 30000);
      }
      // Load the whole snapshot before starting a reply. History (including
      // messages from before this assistant joined) is context, not new work.
      const incoming = value.messages.filter((m) => m.sequence > sequence);
      sequence = Math.max(sequence, value.sequence);
      for (const m of incoming) {
        history.push(m);
        while (
          history.length > 100 ||
          history.reduce((n, x) => n + JSON.stringify(x).length, 0) > 16000
        )
          history.shift();
      }
      for (const m of incoming) {
        if (m.time < value.assistantStartedAt) continue;
        if (m.role !== "viewer" && m.role !== "host") continue;
        // Explicit host commands are interpreted and executed by Go, never by a model.
        if (
          m.role === "host" &&
          /^@AI/i.test(m.text.trim()) &&
          /禁言|踢|移出/.test(m.text)
        )
          continue;
        const explicit = /^@AI(?:\s+|[，,:：]|$)/i.test(m.text.trim());
        if (explicit) {
          if (pending.has(m.memberId)) {
            notice(m, "你的上一个问题还在处理中，请稍等。");
            continue;
          }
          if (queue.length >= 5) {
            notice(m, "现在提问较多，请稍后重试。");
            continue;
          }
          pending.add(m.memberId);
          queue.push({ messages: [m], priority: m.role === "host" ? 2 : 1 });
          void drain();
        } else if (value.settings.autoReply || value.settings.autoModeration) {
          ordinary.push(m);
          if (ordinary.length > 20) ordinary.shift();
          if (!batch) batch = setTimeout(flush, batchMs);
        }
      }
    },
    close() {
      closed = true;
      abort?.abort();
      clearTimeout(batch);
      clearTimeout(welcome);
      queue.length = 0;
      ordinary.length = 0;
      history.length = 0;
      pending.clear();
      newMembers.clear();
      seenMembers.clear();
      notices.clear();
      userAt.clear();
    },
  };
}

// Bound UTF-16 length without leaving a partial surrogate pair.
export function boundReply(text: string) {
  const value = text.trim();
  if (value.length <= 500) return value;
  return value.slice(0, 499).replace(/[\uD800-\uDBFF]$/, "") + "…";
}
