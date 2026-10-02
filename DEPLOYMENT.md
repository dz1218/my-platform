# 部署

业务 API 与持久化任务 Worker 均由 `apps/server` 提供。`apps/agent` 是独立的 TypeScript 模型服务；前端为 `apps/web`。PostgreSQL、Redis 和 LiveKit 可单独部署或使用托管服务。

## 配置

1. 从 `apps/server/.env.example`、`apps/agent/.env.example` 创建各自的 `.env`，保留已有配置。
2. API 和 Worker 使用相同的 `DATABASE_URL`、`REDIS_URL`、`JWT_SECRET`、`AGENT_TOKEN` 和行为配置。Agent 的 `AGENT_TOKEN` 必须与它们一致；模型凭据仅放在 Agent 环境中。
3. 设置 `WEB_ORIGIN` 为前端的完整地址；HTTPS 环境启用 `COOKIE_SECURE=true`。前端的 `COMPANION_API_URL` 指向 Go API，浏览器通过 Next.js `/api/v1/*` 代理访问业务接口。
4. 使用直播功能时，设置 `LIVEKIT_URL`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET`。`LIVEKIT_URL` 必须可被浏览器访问；API 可另设 `LIVEKIT_INTERNAL_URL` 指向内网地址。`LIVEKIT_AGENT_NAME` 默认为 `room-assistant`。

不要把模型凭据、LiveKit 密钥或 Agent Token 放入 `NEXT_PUBLIC_*` 环境变量。未配置 LiveKit 时，房间接口返回 503，其余 API 可正常启动。

## Docker

仓库提供 API/Worker 的 Go 多阶段镜像，以及 Agent 的 Node 22 镜像。先配置环境，再执行：

```bash
./deploy-docker.sh
# 查看服务状态和日志
docker compose -f infra/docker/docker-compose.app.yml ps
docker compose -f infra/docker/docker-compose.app.yml logs -f
```

脚本从当前仓库构建并启动 API、Worker 和 Agent，不会安装 Docker、覆盖配置或创建数据库。API 只绑定宿主机 `127.0.0.1:8080`，Agent 仅在容器网络可见。

数据库和 Redis 地址必须能从容器访问。容器里的 `localhost` 指向容器自身：使用托管地址，或在同一 Docker 网络中使用服务名；访问宿主机服务可使用已配置的 `host.docker.internal`，并确认服务监听地址允许容器访问。根目录的 Compose 文件仅供本地数据库开发，默认只绑定宿主机回环地址。

Compose 已将 API/Worker 的 `AGENT_URL` 设为 `http://agent:8081`。API 与 Worker 启动时会自动应用版本化 SQL 迁移。已有数据库部署前应备份。

## 直接运行

```bash
pnpm install --frozen-lockfile
pnpm --filter agent build
pnpm --filter web build
cd apps/server
go build -o /tmp/companion-api ./cmd/api
go build -o /tmp/companion-worker ./cmd/worker
```

用进程管理器分别启动 API、Worker、Agent (`pnpm --filter agent start`) 和前端 (`pnpm --filter web start`)。Go 进程的工作目录使用 `apps/server`，以便加载 `.env` 和 `config/behavior.json`。非回环网络监听时设置 `SERVER_ADDR=0.0.0.0:8080`。跨主机部署 Agent 时，应使用私有网络并设置相应 `AGENT_URL`。

## 代理与验证

将前端域名反向代理到 Next.js（默认 3011），支持 WebSocket 升级。Next.js 的 `/api/v1/*` 代理 HTTP 请求，`/ws/conversations/:id` 转发聊天 WebSocket。设置服务器端 `COMPANION_API_URL`；不需要浏览器 API 地址配置。

LiveKit 媒体流直接在浏览器与 LiveKit 之间传输，需要独立配置 TLS、TCP/UDP 端口和外部 IP。本地可运行 `pnpm livekit:up`；仓库的 LiveKit 开发配置使用 `127.0.0.1`，不适用于公网部署。

验证 `/health` 返回 200（含数据库、Redis 连通性），再验证登录、聊天、小说和直播房间。房间接口实现见 `apps/server/internal/livekit`。测试命令：

```bash
pnpm server:test
pnpm agent:test
pnpm typecheck
```
