// Synthetic conversations only. Results include text for review, never secrets.
import { readFile, mkdir, appendFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Agent, Runner, OpenAIChatCompletionsModel, type Model } from "@openai/agents";
import OpenAI from "openai";
import { z } from "zod";
import { env } from "../config.js";
import { createCompanion } from "../agents/companion.js";
import { candidatePlan, planOutput, replyInput, type ReplyInput, type CandidatePlan } from "../schemas/plan.js";
import { replyErrorCode } from "../reply-error.js";
import { companionInstructions } from "../prompts/companion-v3.js";

const fixture = z.object({
  id: z.string(), messages: z.array(z.string()), criteria: z.array(z.string()),
  critical: z.boolean().optional(), history: replyInput.shape.messages.optional(),
  facts: z.record(z.string(), z.unknown()).optional(),
  kind: replyInput.shape.kind.optional(),
});
const suiteSchema = z.object({
  cases: z.array(fixture).min(20),
  dialogues: z.array(z.object({ id: z.string(), criteria: z.array(z.string()), turns: z.array(z.string()).length(10) })).min(3),
});
type Variant = "v2" | "v3";
type RecordResult = {
  key: string; variant: Variant; id: string; sample: number; turn: number;
  criteria: string[]; critical: boolean; input: ReplyInput; durationMs: number;
  plan?: CandidatePlan; error?: string;
  diagnosticOutput?: string[]; validationIssues?: unknown;
  modelDiagnostics?: { finishReason?: string; outputTokens: number; reasoningCharacters: number };
};

const { values } = parseArgs({ options: {
  variant: { type: "string", default: "both" },
  samples: { type: "string", default: "3" },
  concurrency: { type: "string", default: "4" },
  case: { type: "string" },
  output: { type: "string", default: "test-results/companion-v3" },
} });
if (!env.LLM_API_KEY) throw new Error("LLM_API_KEY is required for live evaluation");
const samples = z.coerce.number().int().min(1).max(10).parse(values.samples);
const concurrency = z.coerce.number().int().min(1).max(4).parse(values.concurrency);
const variant = z.enum(["both", "v2", "v3"]).parse(values.variant);
const variants: Variant[] = variant === "both" ? ["v2", "v3"] : [variant];
const suite = suiteSchema.parse(JSON.parse(await readFile(new URL("../../evals/companion-v3.json", import.meta.url), "utf8")));
const baseline = await readFile(new URL("../../evals/baseline-v2.txt", import.meta.url), "utf8");
const providerModel = new OpenAIChatCompletionsModel(new OpenAI({ apiKey: env.LLM_API_KEY, baseURL: env.LLM_BASE_URL, timeout: 85000, maxRetries: 0 }), env.LLM_MODEL);
const diagnostics = new AsyncLocalStorage<{ output: string[]; modelDiagnostics?: RecordResult["modelDiagnostics"] }>();
const model: Model = {
  async getResponse(request) {
    const response = await providerModel.getResponse(request);
    const capture = diagnostics.getStore();
    if (capture) {
      const raw = response.providerData as { choices?: { finish_reason?: string; message?: { reasoning_content?: string } }[] } | undefined;
      capture.modelDiagnostics = {
        finishReason: raw?.choices?.[0]?.finish_reason,
        outputTokens: response.usage.outputTokens,
        reasoningCharacters: raw?.choices?.[0]?.message?.reasoning_content?.length ?? 0,
      };
    }
    if (capture) for (const item of response.output) {
      if (item.type === "message" && item.role === "assistant") for (const part of item.content) {
        if (part.type === "output_text") capture.output.push(part.text);
      }
    }
    return response;
  },
  getStreamedResponse: (request) => providerModel.getStreamedResponse(request),
};
const runV3 = createCompanion(model, env.LLM_STRUCTURED_OUTPUT);
const runner = new Runner({ tracingDisabled: true });
const v2 = new Agent({ name: "CompanionV2Baseline", model,
  instructions: baseline + (env.LLM_STRUCTURED_OUTPUT ? "" : '\nJSON 格式：{"action":"REPLY或SILENCE","intent":"chat或empathetic_chat或share或follow_up或closure","messages":[{"clientItemKey":"1","content":"文本","delayMs":0}]}'),
  ...(env.LLM_STRUCTURED_OUTPUT ? { outputType: planOutput } : {}),
  modelSettings: { maxTokens: 1200, ...(env.LLM_STRUCTURED_OUTPUT ? {} : { providerData: { response_format: { type: "json_object" } } }) },
});
const output = resolve(values.output);
await mkdir(output, { recursive: true });
const records = new Map<string, RecordResult>();
const metadata = { model: env.LLM_MODEL, structured: env.LLM_STRUCTURED_OUTPUT, variants, samples, filter: values.case ?? null,
  promptVersions: { v2: "companion-v2", v3: "companion-v3" },
  outputTokenLimits: { v2: 1200, v3: 2048 },
  experimentHash: createHash("sha256").update(JSON.stringify(suite) + baseline + companionInstructions("TURN_REPLY")).digest("hex"),
};
// Resume only this exact configuration; a different experiment needs a new path.
try {
  const previous = JSON.parse(await readFile(resolve(output, "metadata.json"), "utf8"));
  if (JSON.stringify(previous) !== JSON.stringify(metadata)) throw new Error("Evaluation configuration differs; use a new --output directory");
  for (const line of (await readFile(resolve(output, "results.jsonl"), "utf8")).trim().split("\n").filter(Boolean)) {
    const record: RecordResult = JSON.parse(line);
    records.set(record.key, record);
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
await writeFile(resolve(output, "metadata.json"), JSON.stringify(metadata, null, 2));
const baseFacts = { identity: "虚拟陪伴角色林晚，性格自然坦诚，适度幽默。", relationshipStage: "talking", memories: [], summary: "" };
function inputFor(messages: ReplyInput["messages"], facts = {}, kind: ReplyInput["kind"] = "TURN_REPLY") {
  return replyInput.parse({ kind, messages: [{ role: "system", content: JSON.stringify({ ...baseFacts, ...facts }) }, ...messages.slice(-40)] });
}
let writeQueue = Promise.resolve();
async function evaluate(v: Variant, id: string, sample: number, turn: number, input: ReplyInput, criteria: string[], critical = false) {
  const key = `${v}/${id}/${sample}/${turn}`;
  const cached = records.get(key);
  if (cached?.plan && JSON.stringify(cached.input) === JSON.stringify(input)) return cached;
  const started = Date.now();
  const record: RecordResult = { key, variant: v, id, sample, turn, input, criteria, critical, durationMs: 0 };
  const capture: { output: string[]; modelDiagnostics?: RecordResult["modelDiagnostics"] } = { output: [] };
  try {
    const signal = AbortSignal.timeout(90000);
    if (v === "v3") record.plan = candidatePlan.parse(await diagnostics.run(capture, () => runV3(input, signal)).then(({ promptVersion: _, ...plan }) => plan));
    else {
      const result = await diagnostics.run(capture, () => runner.run(v2, JSON.stringify(input), { signal, maxTurns: 1 }));
      record.plan = candidatePlan.parse(typeof result.finalOutput === "string" ? JSON.parse(result.finalOutput) : result.finalOutput);
    }
  } catch (error) {
    record.error = replyErrorCode(error);
    record.diagnosticOutput = capture.output;
    if (error instanceof z.ZodError) record.validationIssues = error.issues;
  }
  record.durationMs = Date.now() - started;
  record.modelDiagnostics = capture.modelDiagnostics;
  records.set(key, record);
  writeQueue = writeQueue.then(() => appendFile(resolve(output, "results.jsonl"), JSON.stringify(record) + "\n"));
  await writeQueue;
  console.info(JSON.stringify({ key, durationMs: record.durationMs, bubbles: record.plan?.messages.length, error: record.error }));
  return record;
}
const jobs: (() => Promise<void>)[] = [];
for (const v of variants) {
  for (const item of suite.cases.filter((c) => !values.case || c.id === values.case)) {
    for (let sample = 1; sample <= samples; sample++) jobs.push(async () => {
      await evaluate(v, item.id, sample, 0, inputFor([
        ...(item.history ?? []), ...item.messages.map((content, i) => ({ role: "user" as const, source: "USER", id: `u${i}`, content })),
      ], item.facts, item.kind), item.criteria, item.critical);
    });
  }
  for (const dialogue of suite.dialogues.filter((c) => !values.case || c.id === values.case)) jobs.push(async () => {
    const history: ReplyInput["messages"] = [];
    for (let i = 0; i < dialogue.turns.length; i++) {
      history.push({ role: "user", source: "USER", id: `u${i}`, content: dialogue.turns[i] });
      const record = await evaluate(v, dialogue.id, 1, i + 1, inputFor(history), dialogue.criteria, true);
      if (!record.plan) continue;
      history.push(...record.plan.messages.map((m, j) => ({ role: "assistant" as const, source: "AI", id: `a${i}-${j}`, content: m.content })));
    }
  });
}
if (!jobs.length) throw new Error("No matching evaluation case");
let cursor = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (cursor < jobs.length) await jobs[cursor++]();
}));
await writeQueue;
const results = [...records.values()];
const statistics = variants.map((v) => {
  const all = results.filter((r) => r.variant === v);
  const successes = all.filter((r) => r.plan);
  const counts = [0, 1, 2, 3].map((n) => successes.filter((r) => r.plan!.messages.length === n).length);
  return { variant: v, completed: all.length, failures: all.length - successes.length, bubbleHistogram: counts,
    meanCharacters: successes.reduce((n, r) => n + r.plan!.messages.reduce((n, m) => n + [...m.content].length, 0), 0) / Math.max(1, successes.length),
    meanGenerationMs: all.reduce((n, r) => n + r.durationMs, 0) / Math.max(1, all.length),
  };
});
await writeFile(resolve(output, "report.json"), JSON.stringify({ metadata, statistics, humanReview: "pending; shape statistics do not establish quality", results }, null, 2));
// Scores intentionally remain unset: reviewers must inspect the actual texts.
await writeFile(resolve(output, "review-template.json"), JSON.stringify(results.map(({ key, criteria, critical }) => ({ key, criteria, critical, accuracy: null, specificity: null, naturalness: null, passesCriteria: null, notes: "" })), null, 2));
console.info(JSON.stringify({ event: "evaluation_finished", output, statistics, humanReview: "pending" }));
if (results.some((r) => r.error)) process.exitCode = 1;
