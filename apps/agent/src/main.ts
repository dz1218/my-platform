import { ChatDeepSeek } from '@langchain/deepseek';
import { env } from './config.js';
import { createCompanionGraph } from './graph/companion.js';
import { createAgentServer } from './server.js';

const ready = Boolean(env.LLM_API_KEY && env.LLM_MODEL);
const model = new ChatDeepSeek({
  apiKey: env.LLM_API_KEY || 'not-configured', model: env.LLM_MODEL,
  configuration: { baseURL: env.LLM_BASE_URL },
  streaming: false, maxTokens: 1000, timeout: 85_000, maxRetries: 0,
  modelKwargs: { thinking: { type: 'disabled' } },
});
const graph = createCompanionGraph(model, env.PROMPT_VERSION);
const server = createAgentServer(env.AGENT_TOKEN, async (input, signal) => {
  const result = await graph.invoke(input, { signal, recursionLimit: 6 });
  return { content: result.content, promptVersion: result.promptVersion };
}, ready);
server.listen(env.AGENT_PORT, env.AGENT_HOST, () => {
  console.log(`[agent] listening on ${env.AGENT_HOST}:${env.AGENT_PORT}; prompt=${env.PROMPT_VERSION}; ready=${ready}`);
});
for (const event of ['SIGTERM', 'SIGINT'] as const) process.once(event, () => {
  server.close(() => process.exit(0));
  setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 95_000).unref();
});
