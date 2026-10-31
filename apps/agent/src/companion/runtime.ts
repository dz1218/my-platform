import { createHash } from "node:crypto";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { Checkpoints, graphVersion } from "./checkpoints.js";
import { runGraph, type GraphServices } from "./graph.js";
import { evidence, type Execution, type RunContext } from "../schemas/runtime.js";
import type { ReplyRunner } from "../server.js";
import type { env } from "../config.js";
import { checkReleaseFile } from "./release-gate.js";
import { promptVersion } from "../prompts/companion-v7.js";

export function createCompanionRuntime(config: typeof env, legacy: ReplyRunner) {
  // No implicit hosted tracing, including when inherited environment flags are set.
  process.env.LANGSMITH_TRACING = "false";
  process.env.LANGCHAIN_TRACING_V2 = "false";
  const checkpoints = config.AGENT_DATABASE_URL ? new Checkpoints(config.AGENT_DATABASE_URL, `${graphVersion}:${promptVersion}:${config.LLM_MODEL}:${config.EMBEDDING_MODEL}:1024`) : undefined;
  if (config.COMPANION_RUNTIME !== "legacy" && !checkpoints) throw new Error("AGENT_DATABASE_URL required for durable Companion execution");
  const model = new ChatOpenAI({ model: config.LLM_MODEL, apiKey: config.LLM_API_KEY || "not-configured", configuration: { baseURL: config.LLM_BASE_URL }, maxRetries: 0, timeout: 85_000, maxTokens: 4096, modelKwargs: { response_format: { type: "json_object" } } });
  async function callback(path: string, body: unknown, signal: AbortSignal) {
    const response = await fetch(`${config.AGENT_SERVER_URL.replace(/\/$/, "")}/internal/companion/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.AGENT_TOKEN}` }, body: JSON.stringify(body), signal });
    if ([401,403,409].includes(response.status)) throw new Error("stale_agent_run");
    if (!response.ok) throw new Error("retrieval_unavailable");
    return response.json() as Promise<unknown>;
  }
  async function embed(texts: string[], signal: AbortSignal) {
    if (!config.EMBEDDING_API_KEY) throw new Error("embedding_not_configured");
    const encoder = new OpenAIEmbeddings({ apiKey: config.EMBEDDING_API_KEY, model: config.EMBEDDING_MODEL, dimensions: 1024, maxRetries: 0, batchSize: 8, timeout: 12_000,
      configuration: { baseURL: config.EMBEDDING_BASE_URL, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) }) },
    });
    const vectors = await encoder.embedDocuments(texts);
    if (vectors.length !== texts.length || vectors.some(v => v.length !== 1024 || v.some(n => !Number.isFinite(n)))) throw new Error("invalid_embedding_response");
    return { model: config.EMBEDDING_MODEL, vectors };
  }
  const services: GraphServices = {
    trace: event => { console.info(JSON.stringify({ event: "companion_node", ...event })); },
    verify: async (run, signal) => { await callback("validate", run, AbortSignal.any([signal, AbortSignal.timeout(3000)])); },
    retrieve: async (run, query, signal) => {
      let vector: number[] | undefined;
      try { vector = (await embed([query], AbortSignal.any([signal, AbortSignal.timeout(1500)]))).vectors[0]; }
      catch { signal.throwIfAborted(); }
      try {
        const result = await callback("search", { run, query, vector, model: config.EMBEDDING_MODEL }, AbortSignal.any([signal, AbortSignal.timeout(3000)]));
        return z.object({ items: z.array(evidence).max(6) }).parse(result).items;
      } catch (error) {
        signal.throwIfAborted(); if (error instanceof Error && error.message === "stale_agent_run") throw error;
        console.info(JSON.stringify({ event: "companion_retrieval_degraded", runId: run.id })); return [];
      }
    },
    model: async (system, input, signal) => {
      const result = await model.invoke([new SystemMessage(system), new HumanMessage(input)], { signal, callbacks: [] });
      const text = typeof result.content === "string" ? result.content : result.content.filter(c => c.type === "text").map(c => c.text).join("");
      return { text, inputTokens: result.usage_metadata?.input_tokens ?? 0, outputTokens: result.usage_metadata?.output_tokens ?? 0 };
    },
  };
  const run: ReplyRunner = async (input, outerSignal) => {
    if (!input.run) return legacy(input, outerSignal);
    const context: RunContext = input.run;
    const remaining = Date.parse(context.deadline) - Date.now();
    if (remaining <= 0) throw new Error("stale_agent_run");
    const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(Math.min(90_000, Math.ceil(remaining)))]);
    await services.verify(context, signal);
    const bucket = createHash("sha256").update(context.conversationId).digest().readUInt32BE(0) % 100;
    const selected = bucket < config.COMPANION_ROLLOUT_PERCENT && config.COMPANION_RUNTIME !== "legacy";
    const graph = (graphSignal = signal, modelLimit = 3) => checkpoints!.withRun(context, (thread, budget) => runGraph(input, graphSignal, services, budget, checkpoints!.saver, thread), modelLimit);
    let result;
    if (selected && config.COMPANION_RUNTIME === "langgraph") result = await graph();
    else {
      const { modelCalls = 1, ...candidate } = await legacy(input, signal);
      const execution: Execution = { runId: context.id, inputHash: context.inputHash, memoryRevision: context.memoryRevision, graphVersion: "legacy", modelCalls, retrievalCalls: 0, inputTokens: 0, outputTokens: 0, evidence: [] };
      result = { ...candidate, execution };
      if (selected && config.COMPANION_RUNTIME === "shadow") {
        try { const shadow = await graph(AbortSignal.any([signal, AbortSignal.timeout(20_000)]), Math.max(0, 3 - modelCalls)); console.info(JSON.stringify({ event: "companion_shadow", actionMatches: candidate.action === shadow.action, ...shadow.execution, evidence: undefined })); }
        catch { console.info(JSON.stringify({ event: "companion_shadow_failed", runId: context.id })); }
      }
    }
    await services.verify(context, signal);
    result.execution.model = config.LLM_MODEL;
    result.execution.indexVersion = `${config.EMBEDDING_MODEL}:1024:hybrid-v1`;
    const { evidence: _evidence, ...metrics } = result.execution;
    console.info(JSON.stringify({ event: "companion_execution", ...metrics }));
    return result;
  };
  return { run, embed, checkpoints, ready: async () => {
    if (checkpoints) await checkpoints.ready(process.env.NODE_ENV === "production");
    if (process.env.NODE_ENV === "production" && config.COMPANION_RUNTIME === "langgraph" && config.COMPANION_ROLLOUT_PERCENT > 0) await checkReleaseFile(config.COMPANION_RELEASE_REPORT, config.LLM_MODEL, `${config.EMBEDDING_MODEL}:1024:hybrid-v1`);
  }, purge: async (conversationId: string, beforeRevision: number) => checkpoints ? checkpoints.purge(conversationId, beforeRevision) : true, close: async () => { await checkpoints?.close(); } };
}
