# 今晚 · Companion

Next.js + Go/Gin + TypeScript Agent (LangChain.js / LangGraph.js), PostgreSQL and Redis.
Chat uses durable asynchronous replies: send succeeds immediately, the complete identity message appears later.

## Local development

Use Node 22 and a Go version compatible with your OS (recent Go on macOS 26).

```bash
nvm use 22
pnpm install
pnpm db:up
```

For a new checkout, copy `apps/server/.env.example` to `apps/server/.env`,
`apps/agent/.env.example` to `apps/agent/.env`, and merge `apps/web/.env.example` into `apps/web/.env.local`.
Set a random JWT secret, and the **same** random `AGENT_TOKEN` in server and agent environments.
Model credentials belong only in `apps/agent/.env`. Go and the existing novel pages must use the same database.
Never overwrite existing local environment files blindly.

Stop earlier dev processes first, then start all four application processes:

```bash
pnpm dev:all
```

Open http://localhost:3011. API and worker automatically apply versioned SQL migrations.
Redis and PostgreSQL must already be running. If you already have PostgreSQL on 5432,
keep using that instance and start only Redis with `docker compose up -d redis`.

Alternatively run each process in its own terminal:

```bash
pnpm server:dev   # Go HTTP API :8080
pnpm worker:dev   # durable generation + delivery jobs
pnpm agent:dev    # TypeScript Agent :8081
pnpm dev          # Next.js :3011
```

## Customization and checks

- [Interaction strategy and architecture](docs/companion-agent.md)
- Delivery policy: `apps/server/config/behavior.json`
- Versioned prompts: `apps/agent/src/prompts/`
- `pnpm server:test`, `pnpm agent:test`, `pnpm typecheck`
- `pnpm --filter web build`, `pnpm --filter agent build`

Existing LiveKit and novel features remain available. LiveKit still uses the legacy API
(`pnpm dev:legacy` and `pnpm livekit:up`); novel pages still use Prisma during this migration.
Older deployment guides describe that legacy stack and do not deploy the new Agent/worker.
