# my-platform

Local monorepo for `Next.js + NestJS + LiveKit`.

## Requirements

- Node.js 22
- pnpm 10+

## Quick start

```bash
cd my-platform
source ~/.nvm/nvm.sh && nvm use 22
pnpm install
cp .env.example .env
cp apps/web/.env.local.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
pnpm db:up
pnpm livekit:up
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:3001/health
- Rooms: http://localhost:3001/rooms

## LiveKit local dev

LiveKit server runs at `ws://127.0.0.1:7880` by default.

```bash
pnpm livekit:up
pnpm livekit:down
```

## Database local dev

PostgreSQL runs at `127.0.0.1:5432` (`postgres/postgres`, db: `my_platform`) by default.

```bash
pnpm db:up
pnpm db:down
```

## Live API

- `GET /rooms` list rooms from LiveKit
- `POST /rooms` create room
- `POST /rooms/:roomId/join` create join token
- `POST /rooms/:roomId/agent/dispatch` dispatch AI agent to room
- `GET /rooms/:roomId/agent/dispatch` list room dispatches
- `DELETE /rooms/:roomId/agent/dispatch/:dispatchId` remove a dispatch
- `DELETE /rooms/:roomId` close room
