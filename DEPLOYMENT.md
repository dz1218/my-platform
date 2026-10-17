# 部署

业务 API 与持久化任务 Worker 均由 `apps/server` 提供。`apps/agent` 是独立的 TypeScript 模型服务；前端为 `apps/web`。PostgreSQL、Redis 和 LiveKit 可单独部署或使用托管服务。

## 配置

1. 从 `apps/server/.env.example`、`apps/agent/.env.example` 创建各自的 `.env`，从 `apps/web/.env.local.example` 创建前端 `.env.local`，保留已有配置；托管部署在对应服务的环境变量中设置这些值。
2. API 和 Worker 使用相同的 `DATABASE_URL`、`REDIS_URL`、`JWT_SECRET`、`AGENT_TOKEN` 和行为配置。Agent 的 `AGENT_TOKEN` 必须与它们一致；模型凭据仅放在 Agent 环境中。
3. 设置 `WEB_ORIGIN` 为前端的完整 origin（协议和域名，不含路径或末尾斜杠）；HTTPS 环境启用 `COOKIE_SECURE=true`。前端的 `COMPANION_API_URL` 指向 Go API，浏览器通过 Next.js `/api/v1/*` 代理访问业务接口。
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

Next.js 的 `/api/v1/*` 代理普通 HTTP 请求。直播大厅与房间状态采用浏览器直连 Go 的 WebSocket：先通过同源 `POST /api/live/connection` 获取连接地址，Next.js 使用现有 HttpOnly 登录 Cookie 向 Go 换取有效期 60 秒、限定房间订阅范围的只读票据。游客也可以订阅公开状态；登录用户的 `canManage` 由 Go 确定。每次重连重新获取票据，长期登录凭据不会返回浏览器 JavaScript。

前端服务器默认将 `COMPANION_API_URL` 的 `http/https` 转为 `ws/wss`，生成 `/api/v1/rooms/socket` 连接地址。若该变量使用仅服务器可达的内网地址，另设服务器端 `COMPANION_WS_URL=wss://api.example.com`，填写浏览器可达的 Go API origin，不带接口路径。HTTPS 网站必须使用 `wss`；此地址是业务状态 WebSocket，不能填写 `LIVEKIT_URL`。以上变量均不需要 `NEXT_PUBLIC_` 前缀。

Vercel 前端配 Railway API 时，使用 Railway 公网 HTTPS 地址作为 `COMPANION_API_URL` 即可自动推导直连地址。大厅与房间状态不依赖 Vercel 的外部 rewrite 转发 WebSocket。自建 Go 反向代理需要为 `/api/v1/rooms/socket` 保留 WebSocket 升级，并允许与 `WEB_ORIGIN` 一致的前端来源。

部署本次连接协议时，先部署包含 `POST /api/v1/rooms/socket-ticket` 和 `/api/v1/rooms/socket` 的 Go API，再部署前端。仅推送 Git 或看到 `/health` 返回 200，不能确认这两个新接口已经上线。浏览器验证应看到同源连接请求成功、随后直连 Go 的 WebSocket 返回 101，并收到完整快照；断网恢复后应重新获取快照，登录用户和游客的管理权限应分别正确。

现有陪伴聊天 `/ws/conversations/:id` 与匹配列表 `/ws/matches` 仍使用 Next.js rewrite，未随直播连接一起迁移；部署平台必须单独验证这两条链路支持 WebSocket 升级。自托管 Next.js 时，将前端域名反向代理到默认 3011 端口并保留升级头。

LiveKit 媒体流直接在浏览器与 LiveKit 之间传输，需要独立配置 TLS、TCP/UDP 端口和外部 IP。本地可运行 `pnpm livekit:up`；仓库的 LiveKit 开发配置使用 `127.0.0.1`，不适用于公网部署。

LiveKit Cloud 还需配置 Webhook 到 `https://<公网 Go API 域名>/api/v1/livekit/webhook`，选择与 `LIVEKIT_API_KEY` 一致的签名密钥。Webhook 直接到 Go，不走前端代理；主播离开关房及共享状态更新依赖这些事件。

验证 `/health` 返回 200（含数据库、Redis 连通性），再验证登录、聊天、小说和直播房间。房间接口实现见 `apps/server/internal/livekit`。测试命令：

```bash
pnpm server:test
pnpm agent:test
pnpm typecheck
```

## 本地与线上隔离

本地开发默认使用 `pnpm db:up` 启动 PostgreSQL/Redis，使用 `pnpm livekit:up` 启动 Docker LiveKit。本地 `apps/server/.env` 使用示例中的本机数据库、Redis、`LIVEKIT_URL=ws://localhost:7880` 及 `devkey` 开发密钥对；前端 `.env.local` 指向 `http://127.0.0.1:8080`。切换配置后重启相应进程，不能只修改浏览器地址。

生产使用独立数据库、Redis 和 LiveKit Cloud 项目。共用 Cloud 项目会让本地与线上查询到同一批 LiveKit 房间；共用 Redis 或数据库也会混用房间状态和账号数据。若本地必须测试 Cloud，请使用独立测试项目及其密钥，并将该项目 Webhook 指向本地 Go 的公网 HTTPS 隧道；不要把生产项目回调改到本地。Docker LiveKit 已将回调指向 `http://host.docker.internal:8080/api/v1/livekit/webhook`，无需修改生产 Cloud 配置。
