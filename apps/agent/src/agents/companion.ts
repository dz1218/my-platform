import { Agent, Runner, type Model } from "@openai/agents";
import {
  parseModelPlan,
  planOutput,
  replyInput,
  type ReplyInput,
} from "../schemas/plan.js";
import { companionInstructions, promptVersion } from "../prompts/companion-v4.js";
import { recentReplyShape } from "./reply-shape.js";

export function createCompanion(model: Model | string, structured = true, prompts = { companionInstructions, promptVersion }) {
  const runner = new Runner({ tracingDisabled: true }); // Chat content never leaves via SDK tracing.
  const makeAgent = (kind: string) => new Agent({
    name: "Companion",
    instructions: prompts.companionInstructions(kind),
    model,
    ...(structured ? { outputType: planOutput } : {}),
    modelSettings: {
      // Leave room for JSON framing and multi-bubble Chinese text. The actual
      // message budget remains 500 Unicode characters, enforced after parsing.
      maxTokens: 2048,
      ...(structured ? {} : { providerData: { response_format: { type: "json_object" } } }),
    },
  });
  const chatAgent = makeAgent("TURN_REPLY");
  const contextAgent = makeAgent("CONTEXT_UPDATE");
  return async (raw: ReplyInput, signal: AbortSignal) => {
    const input = replyInput.parse(raw);
    const isContextUpdate = input.kind === "CONTEXT_UPDATE";
    const enriched = isContextUpdate ? input : { ...input, recentReplyShape: recentReplyShape(input.messages) };
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
