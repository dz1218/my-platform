# 技术架构

当前架构为 Next.js + Go/Gin + TypeScript Agent，使用 PostgreSQL、Redis 和可选的 LiveKit。

| 目录 | 职责 |
| --- | --- |
| `apps/web` | 页面、客户端状态、表单适配、同源 HTTP 代理和聊天 WebSocket 转发 |
| `apps/server/cmd/api` | 鉴权、发现与匹配、会话、小说、LiveKit 房间和调度接口 |
| `apps/server/cmd/worker` | 持久化任务、模型请求、回复校验与延迟投递 |
| `apps/server/internal/livekit` | 房间管理、两小时入房 JWT、LiveKit Twirp 房间和 Agent 调度调用 |
| `apps/agent` | OpenAI Agents SDK + Zod 模型服务，独立于业务 API |
| `apps/server/migrations` | 版本化 SQL 迁移，由 Go 服务启动时应用 |
| `packages/db` | 保留的 Prisma schema 与生成工具，业务请求不通过它访问数据库 |
| `infra/docker` | 本地基础设施和应用容器配置 |

浏览器通过 Next.js `/api/v1/*` 访问 Go API；SSR 使用 `COMPANION_API_URL`。聊天 WebSocket 通过 `/ws/conversations/:id` 转发。直播音视频由浏览器直接连接 LiveKit，Go API 负责房间和令牌。

LiveKit 管理调用使用短期服务令牌，权限按房间操作限定。`LIVEKIT_URL` 是对外连接地址，`LIVEKIT_INTERNAL_URL` 可覆盖服务端管理调用地址；未配置 LiveKit 时房间接口返回 503。该模块使用现有 Go JWT 库与标准 HTTP 客户端，管理请求有超时，并支持上下文取消。

详细行为见 [陪伴架构](docs/companion-agent.md)、[V2](docs/companion-v2.md)、[托管与接管](docs/autopilot.md)。启动与验证见 [README](README.md)，生产部署见 [部署指南](DEPLOYMENT.md)。

## 直播 HTTP 接口

Go 同时提供 `/rooms` 兼容路径和 `/api/v1/rooms`；前端统一使用后者。

| 方法 | 路径（相对于 `/api/v1`） | 用途 |
| --- | --- | --- |
| GET | `/rooms` | 返回 `{ items }`，含标题、人数和直播状态 |
| POST | `/rooms` | 可选 `id`、`title`，返回 `{ item }` |
| POST | `/rooms/:roomId/join` | 可选 `name`，返回 `token`、`livekitUrl`、`roomId`、`identity` |
| DELETE | `/rooms/:roomId` | 关闭房间 |
| POST | `/rooms/:roomId/agent/dispatch` | 可选 `agentName`、对象 `metadata`，返回 `{ item }` |
| GET | `/rooms/:roomId/agent/dispatch` | 返回调度 `{ items }` |
| DELETE | `/rooms/:roomId/agent/dispatch/:dispatchId` | 删除调度 |

房间列表和访客入房公开；创建、关闭及调度操作需要登录。入房身份由服务端生成：访客仅能订阅，登录用户可发布；请求中的 `identity` 不参与授权。不存在的房间返回 404。

本地 LiveKit 协议联调（使用开发 Compose 的地址与密钥，自动清理测试房间）：

```bash
pnpm livekit:up
cd apps/server
LIVEKIT_INTEGRATION=1 go test -run TestLiveKitIntegration -v ./internal/livekit
```

可通过 `LIVEKIT_TEST_URL`、`LIVEKIT_TEST_API_KEY`、`LIVEKIT_TEST_API_SECRET` 指定独立测试实例；联调不会读取应用 `.env`，以免意外访问生产配置。
