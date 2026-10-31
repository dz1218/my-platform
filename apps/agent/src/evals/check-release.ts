import { env } from "../config.js";
import { checkReleaseFile } from "../companion/release-gate.js";
await checkReleaseFile(process.argv[2] || env.COMPANION_RELEASE_REPORT, env.LLM_MODEL, `${env.EMBEDDING_MODEL}:1024:hybrid-v1`);
console.info("Companion release gates passed");
