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
} from "../prompts/companion-v7.js";
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
    const { run: _run, contractVersion: _version, ...input } = replyInput.parse(raw);
    const isContextUpdate = input.kind === "CONTEXT_UPDATE";
    const enriched = isContextUpdate
      ? input
      : { ...input, recentReplyShape: recentReplyShape(input.messages) };
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted();
      const result = await runner.run(
        isContextUpdate ? contextAgent : chatAgent,
        JSON.stringify(attempt === 0 ? enriched : { ...enriched, repair: "上一份输出为空或未通过结构校验。只输出非空 json 对象，完整字段为 action,intent,messages,summary,memoryProposals。messages 每项是含 clientItemKey/content/delayMs 的对象，不是字符串。不得输出空白或代码围栏；正文总计最多500字。CONTEXT_UPDATE 必须 SILENCE。" }),
        { maxTurns: 1, signal },
      );
      try {
        const plan = parseModelPlan(result.finalOutput);
        if (isContextUpdate && plan.action !== "SILENCE") throw new Error("Invalid context update action");
        return { ...plan, promptVersion: prompts.promptVersion, modelCalls: attempt + 1 };
      } catch (error) {
        // One fresh schema repair only. Provider failures and cancellation go
        // straight back to Go; an unsent invalid candidate is never history.
        signal.throwIfAborted();
        if (attempt === 1) throw error;
      }
    }
    throw new Error("invalid_model_plan");
  };
}
