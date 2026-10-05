import { z } from "zod";
export const replyInput = z
  .object({
    messages: z
      .array(
        z.object({
          id: z.string().optional(),
          role: z.enum(["system", "user", "assistant"]),
          content: z.string().min(1).max(20000),
          source: z.string().optional(),
        }),
      )
      .min(1)
      .max(41),
    kind: z
      .enum(["TURN_REPLY", "PROACTIVE", "CONTEXT_UPDATE"])
      .default("TURN_REPLY"),
    allowWait: z.boolean().default(false),
    maxWaitSeconds: z.number().int().min(0).max(30).default(0),
    pendingSeconds: z.number().int().nonnegative().default(0),
  })
  .strict();
export type ReplyInput = z.infer<typeof replyInput>;
export const planOutput = z
  .object({
    summary: z.string().max(1000).nullable(),
    memoryProposals: z
      .array(
        z
          .object({
            sourceMessageId: z.string().min(1),
            kind: z.enum(["FACT", "PREFERENCE", "EXPERIENCE", "BOUNDARY"]),
            content: z.string().min(1).max(300),
          })
          .strict(),
      )
      .max(5),
    action: z.enum(["REPLY", "SILENCE"]),
    intent: z.enum([
      "chat",
      "empathetic_chat",
      "share",
      "follow_up",
      "closure",
    ]),
    messages: z
      .array(
        z
          .object({
            clientItemKey: z.string().min(1).max(80),
            content: z.string().min(1).max(1000),
            delayMs: z.number().int().min(0).max(10000),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
export const candidatePlan = planOutput
  .partial({ summary: true, memoryProposals: true })
  .superRefine((p, ctx) => {
    const keys = p.messages.map((m) => m.clientItemKey);
    if (
      (p.action === "SILENCE" && p.messages.length !== 0) ||
      (p.action === "REPLY" && !p.messages.length) ||
      new Set(keys).size !== keys.length ||
      p.messages.some(
        (m) => !m.content.trim() || [...m.content].length > 500,
      ) ||
      p.messages.reduce((n, m) => n + [...m.content].length, 0) > 500 ||
      p.messages.reduce((n, m) => n + m.delayMs, 0) > 20000
    )
      ctx.addIssue({
        code: "custom",
        message: "Plan exceeds execution limits",
      });
  });
export type CandidatePlan = z.infer<typeof candidatePlan>;

// The server owns timing. JSON-mode providers occasionally omit the advisory
// delay; fill only this harmless default before the unchanged strict validator.
// Never repair actions, content, duplicate keys, budgets or explicit bad values.
export function parseModelPlan(raw: unknown): CandidatePlan {
  if (typeof raw === "string") {
    if (!raw.trim()) throw new Error("Incomplete model response");
    raw = JSON.parse(raw);
  }
  if (raw && typeof raw === "object" && "messages" in raw && Array.isArray(raw.messages)) {
    raw = { ...raw, messages: raw.messages.map((item: unknown) => {
      if (item && typeof item === "object" && !("delayMs" in item)) return { ...item, delayMs: 0 };
      return item;
    }) };
  }
  return candidatePlan.parse(raw);
}
