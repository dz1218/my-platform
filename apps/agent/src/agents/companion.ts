import { Agent, Runner, type Model } from "@openai/agents";
import {
  parseModelPlan,
  planOutput,
  replyInput,
  type ReplyInput,
} from "../schemas/plan.js";
import {
  companionInstructions,
  promptVersion,
} from "../prompts/companion-v5.js";
import { recentReplyShape } from "./reply-shape.js";

export const companionMaxOutputTokens = 4096;

export function createCompanion(
  model: Model | string,
  structured = true,
  prompts = { companionInstructions, promptVersion },
  maxOutputTokens = companionMaxOutputTokens,
) {
  const runner = new Runner({ tracingDisabled: true }); // Chat content never leaves via SDK tracing.
  const makeAgent = (kind: string) =>
    new Agent({
      name: "Companion",
      instructions: prompts.companionInstructions(kind),
      model,
      ...(structured ? { outputType: planOutput } : {}),
      modelSettings: {
        // Some providers count reasoning against this same output budget. Leave
        // room for it plus complete JSON; visible text is still capped at 500 chars.
        maxTokens: maxOutputTokens,
        ...(structured
          ? {}
          : { providerData: { response_format: { type: "json_object" } } }),
      },
    });
  const chatAgent = makeAgent("TURN_REPLY");
  const contextAgent = makeAgent("CONTEXT_UPDATE");
  return async (raw: ReplyInput, signal: AbortSignal) => {
    const input = replyInput.parse(raw);
    const isContextUpdate = input.kind === "CONTEXT_UPDATE";
    const enriched = isContextUpdate
      ? input
      : { ...input, recentReplyShape: recentReplyShape(input.messages) };
    const result = await runner.run(
      isContextUpdate ? contextAgent : chatAgent,
      JSON.stringify(enriched),
      { maxTurns: 1, signal },
    );
    const plan = parseModelPlan(result.finalOutput);
    if (input.kind === "CONTEXT_UPDATE" && plan.action !== "SILENCE")
      throw new Error("Invalid context update action");
    return { ...plan, promptVersion: prompts.promptVersion };
  };
}
