# Companion Agent (TypeScript)

LangChain.js (`@langchain/core`, `@langchain/deepseek`) handles prompts and model access.
LangGraph.js runs `prepare_context → compose_reply → validate_reply` via `invoke`, without streaming.
The private HTTP service binds to 127.0.0.1:8081 by default and requires `AGENT_TOKEN`.

Copy `.env.example` to `.env`, set the same `AGENT_TOKEN` as Go, and configure the model key.
`pnpm --filter agent dev` starts the service. `pnpm --filter agent test` runs offline tests.

Expression prompts live under `src/prompts/`, selected by `PROMPT_VERSION`.
Delivery timing belongs to `apps/server/config/behavior.json`, not prompts.
The service has no database credentials and does not own persistent conversations.
Go supplies a bounded snapshot; no cross-user in-memory checkpoint is shared.
This initial graph does not yet implement long-term memory or tool calling.

The previous LiveKit dispatch health-check placeholder remains available as `pnpm --filter agent dev:livekit`.
