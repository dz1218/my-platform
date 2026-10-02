import { OpenAIChatCompletionsModel } from "@openai/agents";
import OpenAI from "openai";
import { env } from "./config.js";
import { createCompanion } from "./agents/companion.js";
import { createAgentServer } from "./server.js";
const ready = Boolean(env.LLM_API_KEY && env.LLM_MODEL);
const model = new OpenAIChatCompletionsModel(
  new OpenAI({
    apiKey: env.LLM_API_KEY || "not-configured",
    baseURL: env.LLM_BASE_URL,
    timeout: 85000,
    maxRetries: 0,
  }),
  env.LLM_MODEL,
);
const server = createAgentServer(
  env.AGENT_TOKEN,
  createCompanion(model, env.LLM_STRUCTURED_OUTPUT),
  ready,
);
server.listen(env.AGENT_PORT, env.AGENT_HOST, () =>
  console.log(
    `[agent] listening on ${env.AGENT_HOST}:${env.AGENT_PORT}; prompt=companion-v2; ready=${ready}`,
  ),
);
for (const event of ["SIGTERM", "SIGINT"] as const)
  process.once(event, () => {
    server.close(() => process.exit(0));
    setTimeout(() => {
      server.closeAllConnections();
      process.exit(0);
    }, 95000).unref();
  });
