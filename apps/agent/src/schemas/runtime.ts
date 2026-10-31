import { z } from "zod";

export const runContext = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/), claimToken: z.string().min(1).max(128),
  conversationId: z.string().min(1).max(128), userId: z.string().min(1).max(128), identityId: z.string().min(1).max(128),
  settingsVersion: z.number().int().positive(), turnVersion: z.number().int().nonnegative(), memoryRevision: z.number().int().positive(),
  throughMessageId: z.string().regex(/^\d+$/), inputHash: z.string().regex(/^[a-f0-9]{64}$/), deadline: z.string().datetime({ offset: true }), memoryEnabled: z.boolean(),
}).strict();
export type RunContext = z.infer<typeof runContext>;
export const evidence = z.object({ id: z.string().min(1), version: z.number().int().positive(), hash: z.string().min(1), kind: z.enum(["memory", "message", "identity"]), content: z.string().max(6000) }).strict();
export type Evidence = z.infer<typeof evidence>;
export type Usage = { modelCalls: number; retrievalCalls: number; inputTokens: number; outputTokens: number };
export type Execution = Usage & { runId: string; inputHash: string; memoryRevision: number; graphVersion: string; model?: string; indexVersion?: string; evidence: Omit<Evidence, "content">[] };
