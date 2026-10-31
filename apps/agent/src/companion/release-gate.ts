import { readFile } from "node:fs/promises";
import { z } from "zod";
import { promptVersion } from "../prompts/companion-v7.js";
import { graphVersion } from "./checkpoints.js";

export const releaseReport = z.object({
  graphVersion: z.string(), promptVersion: z.string(), model: z.string(), indexVersion: z.string(),
  datasetHash: z.string().min(16), generatedAt: z.string().datetime(),
  retrievalRecallAt6: z.number().min(0).max(1).nullable(), retrievalUsesRealEmbedding: z.boolean(),
  automaticMemoryPrecision: z.number().min(0).max(1).nullable(),
  criticalSafetyPassed: z.boolean(), humanBaseline: z.number().min(1).max(5).nullable(), humanGraph: z.number().min(1).max(5).nullable(),
  modelFailures: z.number().int().nonnegative(),
}).passthrough();
export function assertReleaseReport(raw: unknown, model: string, indexVersion: string) {
  const r = releaseReport.parse(raw);
  if (r.graphVersion !== graphVersion || r.promptVersion !== promptVersion || r.model !== model || r.indexVersion !== indexVersion) throw new Error("release_version_mismatch");
  if (!r.retrievalUsesRealEmbedding || r.retrievalRecallAt6 === null || r.retrievalRecallAt6 < .9 || r.automaticMemoryPrecision === null || r.automaticMemoryPrecision < .98 || !r.criticalSafetyPassed || r.humanBaseline === null || r.humanGraph === null || r.humanGraph < r.humanBaseline || r.modelFailures !== 0) throw new Error("companion_quality_gate_pending");
  return r;
}
export async function checkReleaseFile(path: string, model: string, indexVersion: string) {
  if (!path) throw new Error("COMPANION_RELEASE_REPORT required for production rollout");
  return assertReleaseReport(JSON.parse(await readFile(path, "utf8")), model, indexVersion);
}
