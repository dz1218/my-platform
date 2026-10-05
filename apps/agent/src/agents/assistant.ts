import { Agent, Runner, type Model } from "@openai/agents";
import { assistantInput, parseAssistantReply, type AssistantInput } from "../schemas/assistant.js";

export function createAssistant(model: Model | string) {
  const runner = new Runner({ tracingDisabled: true });
  const agent = new Agent({
    name: "Assistant",
    model,
    instructions: `你是一个独立的问答助手，帮助用户理解知识、解答问题，也可以根据用户主动提供的材料商量如何回复。
你只知道本窗口内用户输入的内容和问答历史，无法看到其他聊天、身份背景或页面信息。缺少必要信息时请用户补充，不要假装知道。
用清楚、自然的语言回答，默认使用中文，用户要求其他语言时遵从。使用普通文本和自然分段，不输出 JSON 或 Markdown 表格。
不确定的事实如实说明。没有联网搜索或外部操作工具，不要声称已经搜索或执行操作。`,
    modelSettings: { maxTokens: 2000 },
  });
  return async (raw: AssistantInput, signal: AbortSignal) => {
    const input = assistantInput.parse(raw);
    const result = await runner.run(agent, input.messages, { maxTurns: 1, signal });
    return parseAssistantReply(result.finalOutput);
  };
}
