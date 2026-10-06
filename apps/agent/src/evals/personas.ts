// Bounded, synthetic-only evaluation: six catalog characters, five turns each.
// Credentials remain in the existing provider configuration and are never logged.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { OpenAIChatCompletionsModel } from "@openai/agents";
import OpenAI from "openai";
import { env } from "../config.js";
import { createCompanion } from "../agents/companion.js";
import { companionInstructions, promptVersion } from "../prompts/companion-v4.js";
import { replyErrorCode } from "../reply-error.js";
import { replyInput, type ReplyInput, type CandidatePlan } from "../schemas/plan.js";

const { values } = parseArgs({ options: {
  catalog: { type: "string", default: "../server/config/identities.json" },
  output: { type: "string", default: "test-results/persona-v4" },
} });
type Character = { id: string; name: string; age: number; city: string; gender: string; background: string; occupationCode: string; persona: Record<string, unknown> };
const catalog: { occupations: { code: string; name: string }[]; identities: Character[] } = JSON.parse(await readFile(resolve(values.catalog), "utf8"));
const fixture: { turns: string[]; criteria: string[] } = JSON.parse(await readFile(new URL("../../evals/persona-v4.json", import.meta.url), "utf8"));
if (fixture.turns.length !== 5 || catalog.occupations.length < 6) throw new Error("Expected five turns and at least six occupations");
if (!env.LLM_API_KEY || !env.LLM_MODEL) throw new Error("Existing model configuration is required");
const selected = Array.from({ length: 6 }, (_, n) => {
  const occupation = catalog.occupations[Math.floor(n * catalog.occupations.length / 6)];
  const people = catalog.identities.filter(i => i.occupationCode === occupation.code);
  const person = people[Math.min(n, people.length - 1)];
  if (!person) throw new Error("Missing character in catalog");
  return { ...person, occupation: occupation.name, fictional: true, personaVersion: 1 };
});
const output = resolve(values.output);
await mkdir(output, { recursive: true });
const hash = createHash("sha256").update(JSON.stringify({ selected, fixture, model: env.LLM_MODEL, structured: env.LLM_STRUCTURED_OUTPUT }) + companionInstructions("TURN_REPLY")).digest("hex");
const metadata = { promptVersion, model: env.LLM_MODEL, experimentHash: hash, characters: selected.map(i => ({ id: i.id, name: i.name, age: i.age, occupation: i.occupation })), profiles: selected };
type Result = { id: string; turn: number; input: string; durationMs: number; plan?: CandidatePlan; error?: string };
let results: Result[] = [];
try {
  const prior = JSON.parse(await readFile(resolve(output, "results.json"), "utf8"));
  if (prior.metadata.experimentHash !== hash) throw new Error("Evaluation changed; choose a new --output directory");
  results = prior.results;
} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
const model = new OpenAIChatCompletionsModel(new OpenAI({ apiKey: env.LLM_API_KEY, baseURL: env.LLM_BASE_URL, timeout: 85000, maxRetries: 0 }), env.LLM_MODEL);
const run = createCompanion(model, env.LLM_STRUCTURED_OUTPUT);
for (const person of selected) {
  const history: ReplyInput["messages"] = [];
  for (const [index, text] of fixture.turns.entries()) {
    history.push({ id: `u${index}`, role: "user", source: "USER", content: text });
    let result = results.find(r => r.id === person.id && r.turn === index + 1);
    if (!result) {
      const started = Date.now();
      result = { id: person.id, turn: index + 1, input: text, durationMs: 0 };
      try {
        const { promptVersion: _, ...plan } = await run(replyInput.parse({ messages: [
          { role: "system", content: JSON.stringify({ identity: person, relationshipStage: "matched", memories: [], summary: "", fictionalDailyState: null }) }, ...history,
        ] }), AbortSignal.timeout(90000));
        result.plan = plan;
      } catch (error) { result.error = replyErrorCode(error); }
      result.durationMs = Date.now() - started;
      results.push(result);
      await writeFile(resolve(output, "results.json"), JSON.stringify({ metadata, criteria: fixture.criteria, results }, null, 2));
    }
    console.info(JSON.stringify({ id: result.id, turn: result.turn, durationMs: result.durationMs, error: result.error ?? null }));
    if (!result.plan) break;
    history.push(...result.plan.messages.map((m, j) => ({ id: `a${index}-${j}`, role: "assistant" as const, source: "AI", content: m.content })));
  }
}
const failures = results.filter(r => r.error).length;
await writeFile(resolve(output, "review-template.json"), JSON.stringify(selected.map(({ id, name }) => ({ id, name, identityConsistent: null, naturalness: null, correctUserMemory: null, noInventedHistory: null, notes: "" })), null, 2));
console.info(JSON.stringify({ output, completed: results.length, failures, humanReview: "pending; model responses require review" }));
if (failures || results.length !== 30) process.exitCode = 1;
