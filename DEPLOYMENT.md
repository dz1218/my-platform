# my-platform 上线文档（生产环境）

本文档基于当前仓库代码整理，目标是快速稳定上线：

- 前端：Vercel（`apps/web`）
- 后端：Railway / Render（`apps/api`）
- 数据库：Supabase Postgres
- Redis：Upstash
- 实时音视频：LiveKit Cloud

## 1. 上线前检查

1. 本地可正常构建：

```bash
pnpm build
```

2. Node 版本建议使用 `22.x`（仓库 engines 要求 `>=22 <25`）。

3. 代码已推送到 Git 仓库（GitHub/GitLab）。

## 2. 先准备 3 个云服务

1. Supabase：创建 Postgres，拿到 `DATABASE_URL`
2. Upstash：创建 Redis，拿到 `REDIS_URL`
3. LiveKit Cloud：创建项目，拿到：
   - `LIVEKIT_URL`（`wss://...`）
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`

## 3. 部署 API（apps/api）

建议 Railway/Render 二选一，核心是把以下环境变量配齐：

```bash
NODE_ENV=production
PORT=3001
WEB_ORIGIN=https://<你的-web-域名>
DATABASE_URL=<Supabase 提供的连接串>
REDIS_URL=<Upstash 提供的连接串>
LIVEKIT_URL=<LiveKit Cloud 的 wss 地址>
LIVEKIT_API_KEY=<LiveKit key>
LIVEKIT_API_SECRET=<LiveKit secret>
LIVEKIT_AGENT_NAME=room-assistant
JWT_SECRET=<随机32位以上>
```

构建/启动命令建议：

```bash
# Build
pnpm --filter api build

# Start
pnpm --filter api start
```

部署后先测健康检查：

```bash
curl https://<你的-api-域名>/health
```

返回 `{"ok":true,"service":"api"}` 即正常。

## 4. 初始化生产数据库

当前仓库无 Prisma migration 历史文件，首次上线用 `db push`：

```bash
pnpm --filter @my-platform/db exec prisma db push --schema prisma/schema.prisma
```

如果你在 CI/CD 执行这一步，确保环境里的 `DATABASE_URL` 已指向生产库。

## 5. 部署 Web（apps/web）

Vercel 建议配置：

- Framework: Next.js
- Root Directory: `apps/web`

Web 环境变量：

```bash
NEXT_PUBLIC_API_BASE_URL=https://<你的-api-域名>
NEXT_PUBLIC_LIVEKIT_URL=wss://<你的-livekit-域名>
DATABASE_URL=<Supabase 提供的连接串>
AUTH_SECRET=<随机32位以上>
NODE_ENV=production
```

说明：

- 本项目登录/注册走 Prisma，`web` 运行时也需要 `DATABASE_URL`。
- `AUTH_SECRET` 用于签名登录态 cookie。

## 6. 发布后回填 CORS

前端域名确定后，回到 API 平台把：

```bash
WEB_ORIGIN=https://<你的-vercel-正式域名>
```

更新并重启 API 服务。

## 7. 联调验收清单

1. 打开首页：`https://<web-domain>/`
2. 注册新账号
3. 登录
4. 创建房间
5. 两个浏览器加入同一房间（测试音视频）
6. 检查 API 日志无 4xx/5xx 异常

## 8. 常见坑（本仓库已知）

1. `vercel.json` 里写的是 `NEXT_PUBLIC_API_URL`，但代码真实读取的是 `NEXT_PUBLIC_API_BASE_URL`。  
   请以代码环境变量为准。

2. `LIVEKIT_URL` 必须是客户端可访问地址（通常是 `wss://...`），不能填内网容器地址。

3. `DATABASE_URL` 必须同时配置给 API 和 Web（Web 有服务端 action + Prisma 访问数据库）。

## 9. 推荐的上线顺序（最稳）

1. 配好 Supabase / Upstash / LiveKit
2. 先上 API 并测 `/health`
3. 初始化数据库 schema（`prisma db push`）
4. 再上 Web
5. 回填 API 的 `WEB_ORIGIN`
6. 全链路验收

