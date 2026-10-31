// Real chat-model smoke evaluation, synthetic data only. Retrieval is a fixture;
// its result must never be reported as production vector-retrieval quality.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { env } from "../config.js";
import { runGraph, type GraphServices } from "../companion/graph.js";
import { graphVersion, type Budget } from "../companion/checkpoints.js";
import { createCompanion } from "../agents/companion.js";
import { createModel } from "../model.js";
import { replyInput } from "../schemas/plan.js";
import { replyErrorCode } from "../reply-error.js";
import type { Usage } from "../schemas/runtime.js";
import { promptVersion } from "../prompts/companion-v7.js";

const { values } = parseArgs({ options: { output: { type: "string", default: "test-results/companion-v6" }, case: { type: "string" } } });
if (!env.LLM_API_KEY) throw new Error("LLM_API_KEY is required");
process.env.LANGSMITH_TRACING = "false"; process.env.LANGCHAIN_TRACING_V2 = "false";
const cases: { id: string; kind: "TURN_REPLY" | "CONTEXT_UPDATE"; text: string; expectedAutomatic?: boolean; evidence?: string }[] = JSON.parse(await readFile(new URL("../../evals/companion-v6.json", import.meta.url), "utf8"));
const output = resolve(values.output); await mkdir(output, { recursive: true });
const datasetHash = createHash("sha256").update(JSON.stringify(cases)).digest("hex");
const model = new ChatOpenAI({ model: env.LLM_MODEL, apiKey: env.LLM_API_KEY, configuration: { baseURL: env.LLM_BASE_URL }, maxRetries: 0, maxTokens: 4096, timeout: 85_000, modelKwargs: { response_format: { type: "json_object" } } });
const legacy = createCompanion(createModel(env), env.LLM_STRUCTURED_OUTPUT);
const results: Record<string, unknown>[] = [];
let inputTokens = 0, outputTokens = 0;
for (const c of cases) {
  if (values.case && c.id !== values.case) continue;
  const rawOutputs: string[] = [];
  const input = replyInput.parse({ contractVersion: 2, kind: c.kind, run: { id: createHash("sha256").update(c.id).digest("hex"), claimToken: "synthetic-evaluation", conversationId: `eval-${c.id}`, userId: "synthetic-user", identityId: "synthetic-role", settingsVersion: 1, turnVersion: 1, memoryRevision: 1, throughMessageId: "1", inputHash: datasetHash, deadline: new Date(Date.now() + 90_000).toISOString(), memoryEnabled: true }, messages: [{ role: "system", content: JSON.stringify({ identity: { name: "林晚", age: 27, city: "杭州", occupation: "书店编辑", background: "住在杭州，喜欢散步和旧书。", fictional: true }, summary: "", memories: [], relationshipStage: "talking" }) }, { role: "user", id: "1", source: "USER", content: c.text }] });
  const usage: Usage = { modelCalls: 0, retrievalCalls: 0, inputTokens: 0, outputTokens: 0 };
  const budget: Budget = { reserve: async kind => { const field = kind === "model" ? "modelCalls" : "retrievalCalls"; if (++usage[field] > (kind === "model" ? 3 : 2)) throw new Error("execution_budget_exceeded"); }, usage: async (i, o) => { usage.inputTokens += i; usage.outputTokens += o; }, stats: async () => ({ ...usage }) };
  const services: GraphServices = { verify: async () => {}, retrieve: async () => c.evidence ? [{ id: "fixture", kind: "memory", version: 1, hash: datasetHash, content: c.evidence }] : [], model: async (system, data, signal) => { const response = await model.invoke([new SystemMessage(system), new HumanMessage(data)], { signal, callbacks: [] }); const text = String(response.content); rawOutputs.push(text); return { text, inputTokens: response.usage_metadata?.input_tokens ?? 0, outputTokens: response.usage_metadata?.output_tokens ?? 0 }; } };
  const started = Date.now(); let result: Record<string, unknown>;
  try { result = { plan: await runGraph(input, AbortSignal.timeout(90_000), services, budget) }; }
  catch (error) { result = { error: replyErrorCode(error) }; }
  result = { id: c.id, kind: c.kind, text: c.text, expectedAutomatic: c.expectedAutomatic, ...result, rawOutputs, durationMs: Date.now() - started, usage };
  inputTokens += usage.inputTokens; outputTokens += usage.outputTokens;
  if (c.kind === "TURN_REPLY") {
    const baselineStarted = Date.now();
    try { result.baseline = await legacy(input, AbortSignal.timeout(90_000)); }
    catch (error) { result.baselineError = replyErrorCode(error); }
    result.baselineDurationMs = Date.now() - baselineStarted;
  }
  results.push(result);
  await writeFile(resolve(output, "results.json"), JSON.stringify({ datasetHash, model: env.LLM_MODEL, results }, null, 2));
  console.info(JSON.stringify({ case: c.id, durationMs: result.durationMs, error: result.error ?? null, ...usage }));
}
const durations = results.map(r => Number(r.durationMs)).sort((a,b) => a-b);
const priceIn = Number(process.env.EVAL_INPUT_PRICE_PER_MILLION), priceOut = Number(process.env.EVAL_OUTPUT_PRICE_PER_MILLION);
const report = { graphVersion, promptVersion, model: env.LLM_MODEL, indexVersion: `${env.EMBEDDING_MODEL}:1024:hybrid-v1`, generatedAt: new Date().toISOString(), datasetHash,
  modelFailures: results.filter(r => r.error || r.baselineError).length, cases: results.length,
  retrievalRecallAt6: null, retrievalUsesRealEmbedding: false, automaticMemoryPrecision: null, criticalSafetyPassed: false, humanBaseline: null, humanGraph: null,
  p50Ms: durations[Math.floor(durations.length*.5)], p95Ms: durations[Math.min(durations.length-1,Math.floor(durations.length*.95))], inputTokens, outputTokens,
  graphCostEstimate: Number.isFinite(priceIn) && Number.isFinite(priceOut) ? (inputTokens*priceIn+outputTokens*priceOut)/1_000_000 : null,
  notes: "Synthetic chat smoke only; fill retrieval from real Go+embedding evaluation, precision from Go memory admission, safety from integration evidence, human scores from blind review. Null means unverified. Cost excludes legacy baseline and embeddings; provider billing is authoritative." };
await writeFile(resolve(output, "release-report.json"), JSON.stringify(report, null, 2));
console.info(JSON.stringify({ report: resolve(output, "release-report.json"), modelFailures: report.modelFailures, p50Ms: report.p50Ms, p95Ms: report.p95Ms, inputTokens, outputTokens }));
if (report.modelFailures) process.exitCode = 1;
