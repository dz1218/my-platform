import type { ReplyInput } from "../schemas/plan.js";

export type ReplyShape = {
  bubbleCount: number;
  characterCount: number;
  endsWithQuestion: boolean;
};

// Only committed, explicitly AI-sourced history contributes. Human/unknown
// sources remain in the input but must not become AI style observations.
export function recentReplyShape(messages: ReplyInput["messages"]): ReplyShape[] {
  const shapes: ReplyShape[] = [];
  let current: ReplyShape | undefined;
  for (const message of messages) {
    if (message.role !== "assistant" || message.source !== "AI") {
      current = undefined;
      continue;
    }
    if (!current) {
      current = { bubbleCount: 0, characterCount: 0, endsWithQuestion: false };
      shapes.push(current);
    }
    current.bubbleCount++;
    current.characterCount += [...message.content].length;
    current.endsWithQuestion = /[?？][\s”’"'）)]*$/u.test(message.content);
  }
  return shapes.slice(-4);
}
