import { z } from "zod";

export const assistantInput = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(32768).refine((text) => !!text.trim()),
  }).strict()).min(1).max(41),
}).strict().refine(({ messages }) =>
  messages.length % 2 === 1 && messages.every((message, index) =>
    message.role === (index % 2 === 0 ? "user" : "assistant")),
  "Expected completed turns followed by a user question",
);

export type AssistantInput = z.infer<typeof assistantInput>;
export type AssistantReply = { content: string };

export function parseAssistantReply(content: unknown): AssistantReply {
  if (typeof content !== "string" || !content.trim() || Buffer.byteLength(content) > 32768)
    throw new Error("Invalid assistant response");
  return { content: content.trim() };
}
