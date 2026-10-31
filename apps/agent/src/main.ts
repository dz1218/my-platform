import { createModel } from "./model.js";
import { env } from "./config.js";
import { createCompanion } from "./agents/companion.js";
import { createAssistant } from "./agents/assistant.js";
import { createAgentServer } from "./server.js";
import { promptVersion } from "./prompts/companion-v7.js";
import { createCompanionRuntime } from "./companion/runtime.js";
const ready = Boolean(env.LLM_API_KEY && env.LLM_MODEL);
const model = createModel(env);
const companion = createCompanionRuntime(env, createCompanion(model, env.LLM_STRUCTURED_OUTPUT));
await companion.ready();
const cleanup = setInterval(() => { void companion.checkpoints?.purge().catch(() => console.warn("companion checkpoint cleanup failed")); }, 60_000);
cleanup.unref();
const server = createAgentServer(
  env.AGENT_TOKEN,
  companion.run,
  ready,
  createAssistant(model),
  { embed: companion.embed, purge: companion.purge },
);
server.listen(env.AGENT_PORT, env.AGENT_HOST, () =>
  console.log(
    `[agent] listening on ${env.AGENT_HOST}:${env.AGENT_PORT}; prompt=${promptVersion}; ready=${ready}`,
  ),
);
for (const event of ["SIGTERM", "SIGINT"] as const)
  process.once(event, () => {
    clearInterval(cleanup);
    server.close(() => { void companion.close().finally(() => process.exit(0)); });
    setTimeout(() => {
      server.closeAllConnections();
      process.exit(0);
    }, 95000).unref();
  });
