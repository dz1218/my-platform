// Real-model regressions for private chat, using synthetic data only. This is
// not a replacement for retrieval evaluation or a human naturalness review.
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createCompanion } from "../agents/companion.js";
import { runGraph } from "../companion/graph.js";
import type { Budget } from "../companion/checkpoints.js";
import { env } from "../config.js";
import { createModel } from "../model.js";
import { promptVersion } from "../prompts/companion-v7.js";
import { replyInput, type ReplyInput } from "../schemas/plan.js";

if (!env.LLM_API_KEY) throw new Error("LLM_API_KEY is required");
process.env.LANGSMITH_TRACING = "false";
process.env.LANGCHAIN_TRACING_V2 = "false";
const legacyModel = createModel(env);
const getResponse = legacyModel.getResponse.bind(legacyModel);
let candidateText: string[] = [];
legacyModel.getResponse = async (...args) => {
  const response = await getResponse(...args);
  candidateText = response.output.flatMap(item => {
    if (item.type !== "message" || item.role !== "assistant") return [];
    if (typeof item.content === "string") return [item.content];
    return item.content.flatMap(part => part.type === "output_text" ? [part.text] : []);
  });
  return response;
};
const legacy = createCompanion(legacyModel, env.LLM_STRUCTURED_OUTPUT);
const model = new ChatOpenAI({ model: env.LLM_MODEL, apiKey: env.LLM_API_KEY, configuration: { baseURL: env.LLM_BASE_URL }, maxRetries: 0, timeout: 85_000, maxTokens: 4096, modelKwargs: { response_format: { type: "json_object" } } });
const cases: { id: string; date: string; weekday: string; text: string; history?: ReplyInput["messages"]; check: (text: string) => boolean }[] = [
  { id: "holiday", date: "2026-10-31", weekday: "星期六", text: "今天是什么节日", check: text => /万圣/.test(text) && !/不知道.*几号|不确定.*几号|你那边.*日子/.test(text) },
  { id: "calendar", date: "2026-11-01", weekday: "星期日", text: "今天几号，星期几？", check: text => /11月1|十一月一|11[/-]0?1/.test(text) && /星期[日天]|周[日天]|礼拜[日天]/.test(text) },
  { id: "ordinary-life", date: "2026-10-31", weekday: "星期六", text: "你在干嘛呢", check: text => !/作为AI|作为一个|虚构设定|资料.{0,8}没有|不能.{0,6}编造|没有.{0,4}日常/.test(text) },
  { id: "recent-context", date: "2026-10-31", weekday: "星期六", text: "我刚说想去哪来着？", history: [{ role: "user", source: "USER", content: "我准备下周去成都，还没订票。" }, { role: "assistant", source: "AI", content: "成都呀，我一想到那儿就想吃火锅" }], check: text => /成都/.test(text) && !/你已经去|你去过|你.{0,5}说.{0,8}火锅|记忆.{0,4}关闭/.test(text) },
  { id: "long-reply", date: "2026-10-31", weekday: "星期六", text: "给我500字，聊聊你怎么看普通日子里的快乐，像平常跟我聊天那样。", check: text => [...text].length >= 400 && [...text].length <= 500 },
  { id: "unknown-past", date: "2026-10-31", weekday: "星期六", text: "你还记得我们上次一起去海边住的酒店叫什么吗", check: text => !/酒店叫|住的是|当然记得|怎么会忘/.test(text) },
];
const directory = "test-results/private-chat";
await mkdir(directory, { recursive: true });
const results: Record<string, unknown>[] = [];
for (const c of cases) {
  for (const runner of ["legacy", "langgraph"] as const) {
    const input = replyInput.parse({ kind: "TURN_REPLY", contractVersion: 2, run: {
      id: createHash("sha256").update(c.id).digest("hex"), claimToken: "synthetic", conversationId: "synthetic-conversation", userId: "synthetic-user", identityId: "synthetic-role",
      settingsVersion: 1, turnVersion: 1, memoryRevision: 1, throughMessageId: "1", inputHash: createHash("sha256").update(JSON.stringify(c)).digest("hex"), memoryEnabled: false, deadline: new Date(Date.now() + 90_000).toISOString(),
    }, messages: [{ role: "system", content: JSON.stringify({
      identity: { name: "林晚", age: 27, occupation: "编辑", city: "杭州", background: "喜欢旧书和散步", fictional: true, persona: { personality: "温柔，有自己的主见", speakingStyle: "自然直接", interests: ["阅读", "散步"] } },
      clock: { date: c.date, weekday: c.weekday, timeZone: "Asia/Shanghai", dayPeriod: "晚上" }, relationshipStage: "talking", memories: [], summary: "", fictionalDailyState: null,
    }) }, ...(c.history ?? []), { role: "user", source: "USER", id: "1", content: c.text }] });
    const usage = { modelCalls: 0, retrievalCalls: 0, inputTokens: 0, outputTokens: 0 };
    const budget: Budget = { reserve: async kind => { const key = kind === "model" ? "modelCalls" : "retrievalCalls"; if (++usage[key] > (kind === "model" ? 3 : 2)) throw new Error("budget_exceeded"); }, usage: async (i, o) => { usage.inputTokens += i; usage.outputTokens += o; }, stats: async () => ({ ...usage }) };
    const started = Date.now();
    candidateText = [];
    let result: Record<string, unknown>;
    try {
      const signal = AbortSignal.timeout(90_000);
      const plan = runner === "legacy" ? await legacy(input, signal) : await runGraph(input, signal, {
        verify: async () => {}, retrieve: async () => { throw new Error("memory_disabled"); },
        model: async (system, data, signal) => {
          const response = await model.invoke([new SystemMessage(system), new HumanMessage(data)], { signal, callbacks: [] });
          return { text: String(response.content), inputTokens: response.usage_metadata?.input_tokens ?? 0, outputTokens: response.usage_metadata?.output_tokens ?? 0 };
        },
      }, budget);
      const text = plan.messages.map(m => m.content).join("");
      result = { passed: plan.action === "REPLY" && c.check(text), characters: [...text].length, messages: plan.messages, promptVersion: plan.promptVersion };
    } catch (error) { result = { passed: false, error: error instanceof Error ? error.message : "unknown", candidateText }; }
    results.push({ case: c.id, runner, ...result, durationMs: Date.now() - started, usage: runner === "langgraph" ? usage : null });
    await writeFile(`${directory}/results.json`, JSON.stringify({ model: env.LLM_MODEL, promptVersion, generatedAt: new Date().toISOString(), results }, null, 2));
    console.info(JSON.stringify({ case: c.id, runner, passed: result.passed, durationMs: Date.now() - started }));
  }
}
if (results.some(r => !r.passed)) process.exitCode = 1;
