# My Platform - 完整技术方案

> 基于 Next.js + NestJS + LiveKit 的实时直播平台

---

## 📋 目录

1. [项目概述](#项目概述)
2. [技术架构](#技术架构)
3. [技术栈](#技术栈)
4. [项目结构](#项目结构)
5. [核心模块详解](#核心模块详解)
6. [数据流与交互](#数据流与交互)
7. [LiveKit 集成方案](#livekit-集成方案)
8. [开发环境搭建](#开发环境搭建)
9. [生产部署架构](#生产部署架构)
10. [扩展建议](#扩展建议)

---

## 项目概述

这是一个基于 **Turborepo Monorepo** 架构的实时直播平台，支持多人实时音视频互动。

### 核心功能

- ✅ **房间管理**：创建、列表、删除直播房间
- ✅ **实时音视频**：基于 WebRTC 的低延迟直播
- ✅ **多人互动**：支持主播和观众实时互动
- ✅ **Token 鉴权**：基于 JWT 的安全访问控制

### 适用场景

- 在线教育直播
- 远程会议系统
- 互动直播平台
- 实时监控系统

---

## 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                        用户浏览器                              │
│  ┌──────────────┐    ┌──────────────┐   ┌──────────────┐   │
│  │  主播端 A     │    │  观众端 B     │   │  观众端 C     │   │
│  │ Next.js 前端  │    │ Next.js 前端  │   │ Next.js 前端  │   │
│  └──────┬───────┘    └──────┬───────┘   └──────┬───────┘   │
└─────────┼────────────────────┼───────────────────┼──────────┘
          │                    │                   │
          │ HTTP API           │ HTTP API          │ HTTP API
          ├────────────────────┴───────────────────┤
          ▼                                        ▼
┌─────────────────────────────────────────────────────────────┐
│                     NestJS API Server                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Controllers (房间管理、Token 生成)                     │  │
│  │  - GET  /rooms         列出所有房间                     │  │
│  │  - POST /rooms         创建房间                         │  │
│  │  - POST /rooms/:id/join 生成 JWT Token                 │  │
│  │  - DELETE /rooms/:id   删除房间                         │  │
│  └───────────────────────────────────────────────────────┘  │
│                            ▲                                 │
│                            │ LiveKit Server SDK              │
└────────────────────────────┼─────────────────────────────────┘
                             │
          ┌──────────────────┴──────────────────┐
          ▼                                     ▼
┌──────────────────────────┐      ┌───────────────────────────┐
│   LiveKit Server         │      │   PostgreSQL              │
│   (WebRTC SFU)           │      │   + Prisma ORM            │
│                          │      │   (用户/房间持久化数据)    │
│  - WebSocket: 7880       │      └───────────────────────────┘
│  - TCP:       7881       │
│  - UDP:       7882       │      ┌───────────────────────────┐
│                          │      │   Redis                   │
│  媒体流转发               │      │   (缓存/Session)           │
└──────────────────────────┘      └───────────────────────────┘
```

### 架构特点

1. **Monorepo 管理**：使用 Turborepo 统一管理多个应用和包
2. **前后端分离**：Next.js 前端 + NestJS 后端，职责清晰
3. **WebRTC SFU**：LiveKit 作为媒体服务器，支持多人低延迟直播
4. **微服务就绪**：模块化设计，易于拆分为微服务

---

## 技术栈

### 前端 (apps/web)

| 技术 | 版本 | 用途 |
|------|------|------|
| **Next.js** | 15.5.0 | React 全栈框架，SSR/SSG |
| **React** | 19.1.1 | UI 组件库 |
| **livekit-client** | ^2.15.2 | WebRTC 客户端 SDK |
| **TypeScript** | ^5.9.2 | 类型安全 |
| **Zod** | ^3.24.1 | 运行时数据验证 |

### 后端 (apps/api)

| 技术 | 版本 | 用途 |
|------|------|------|
| **NestJS** | ^11.1.6 | Node.js 企业级框架 |
| **livekit-server-sdk** | ^2.13.1 | LiveKit 服务端 SDK |
| **class-validator** | ^0.14.2 | DTO 验证 |
| **Zod** | ^3.24.1 | 环境变量验证 |
| **TypeScript** | ^5.9.2 | 类型安全 |
| **tsx** | ^4.20.5 | TS 开发热重载 |

### 数据层 (packages/db)

| 技术 | 版本 | 用途 |
|------|------|------|
| **Prisma** | ^6.14.0 | ORM + 数据库迁移 |
| **PostgreSQL** | - | 关系型数据库 |

### 基础设施 (infra)

| 技术 | 版本 | 用途 |
|------|------|------|
| **LiveKit Server** | latest | WebRTC SFU 媒体服务器 |
| **Docker Compose** | - | 容器编排 |
| **Redis** | - | 缓存/Session (预留) |

### 开发工具

| 技术 | 版本 | 用途 |
|------|------|------|
| **Turborepo** | ^2.5.6 | Monorepo 构建工具 |
| **pnpm** | 10.10.0 | 包管理器 |
| **Node.js** | 25 | JavaScript 运行时 |

---

## 项目结构

```
my-platform/
├── apps/
│   ├── web/                          # Next.js 前端应用
│   │   ├── src/
│   │   │   ├── app/                  # App Router 路由
│   │   │   │   ├── page.tsx          # 首页
│   │   │   │   ├── live/             # 直播模块
│   │   │   │   │   ├── page.tsx      # 房间列表（大厅）
│   │   │   │   │   └── [roomId]/    # 动态路由
│   │   │   │   │       └── page.tsx  # 房间页面
│   │   │   │   ├── login/            # 登录页
│   │   │   │   ├── novels/           # 小说模块（示例）
│   │   │   │   └── layout.tsx        # 全局布局
│   │   │   ├── components/           # React 组件
│   │   │   │   └── live/
│   │   │   │       ├── live-lobby-client.tsx   # 房间列表客户端组件
│   │   │   │       └── live-room-client.tsx    # 房间客户端组件
│   │   │   └── lib/                  # 工具库
│   │   │       ├── api.ts            # API 客户端
│   │   │       └── env.ts            # 环境变量验证
│   │   ├── .env.local                # 前端环境变量
│   │   └── package.json
│   │
│   └── api/                          # NestJS 后端 API
│       ├── src/
│       │   └── main.ts               # 单文件 NestJS 应用
│       ├── .env                      # 后端环境变量
│       └── package.json
│
├── packages/                         # 共享包
│   ├── db/                           # 数据库包
│   │   ├── prisma/
│   │   │   └── schema.prisma         # Prisma 数据模型
│   │   └── package.json
│   │
│   └── shared/                       # 共享类型和工具
│       ├── src/
│       │   └── index.ts              # 共享类型定义
│       └── package.json
│
├── infra/                            # 基础设施配置
│   └── docker/
│       ├── docker-compose.livekit.yml  # LiveKit 容器配置
│       └── livekit.dev.yaml            # LiveKit 服务器配置
│
├── .env                              # 根环境变量（共享）
├── .env.example                      # 环境变量模板
├── package.json                      # 根 package.json
├── pnpm-workspace.yaml               # pnpm workspace 配置
├── turbo.json                        # Turborepo 配置
└── README.md                         # 项目说明
```

---

## 核心模块详解

### 1. 前端模块 (apps/web)

#### 1.1 路由设计

| 路由 | 文件路径 | 功能 |
|------|---------|------|
| `/` | `app/page.tsx` | 首页 |
| `/live` | `app/live/page.tsx` | 直播大厅（房间列表） |
| `/live/[roomId]` | `app/live/[roomId]/page.tsx` | 直播房间 |
| `/login` | `app/login/page.tsx` | 登录页 |

#### 1.2 核心组件

**LiveLobbyClient** (`components/live/live-lobby-client.tsx`)

功能：
- 展示房间列表
- 创建新房间
- 关闭房间

关键代码：
```typescript
async function createRoom() {
  const response = await fetch(`${apiBaseUrl}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title.trim() || undefined })
  });
  // ...
}
```

**LiveRoomClient** (`components/live/live-room-client.tsx`)

功能：
- 连接 LiveKit 房间
- 本地音视频采集和预览
- 远端媒体流展示
- 错误处理

关键流程：
```typescript
1. 用户输入 identity
2. 调用 POST /rooms/:roomId/join 获取 JWT token
3. 使用 livekit-client 连接房间：
   const room = new Room();
   await room.connect(livekitUrl, token);
4. 监听事件：TrackSubscribed, ParticipantConnected 等
5. 渲染视频流到 DOM
```

#### 1.3 环境变量 (apps/web/.env.local)

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3020  # API 服务器地址
NEXT_PUBLIC_LIVEKIT_URL=ws://localhost:7880     # LiveKit WebSocket 地址
```

---

### 2. 后端模块 (apps/api)

#### 2.1 API 端点

| 方法 | 路径 | 功能 | 请求体 | 响应 |
|------|------|------|--------|------|
| GET | `/health` | 健康检查 | - | `{ ok: true }` |
| GET | `/rooms` | 获取房间列表 | - | `{ items: RoomItem[] }` |
| POST | `/rooms` | 创建房间 | `{ title?, id? }` | `{ item: RoomItem }` |
| POST | `/rooms/:roomId/join` | 加入房间（生成 token） | `{ identity, name? }` | `{ token, livekitUrl, roomId, identity }` |
| DELETE | `/rooms/:roomId` | 删除房间 | - | `{ ok: true }` |

#### 2.2 LiveKit Token 生成

```typescript
const accessToken = new AccessToken(
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET,
  {
    identity: 'user123',
    name: '用户名',
    ttl: '2h'  // Token 有效期 2 小时
  }
);

accessToken.addGrant({
  roomJoin: true,         // 允许加入房间
  room: roomId,           // 指定房间
  canPublish: true,       // 允许推流
  canSubscribe: true,     // 允许拉流
  canPublishData: true    // 允许发送数据消息
});

const jwt = await accessToken.toJwt();
```

#### 2.3 环境变量 (apps/api/.env)

```bash
PORT=3020                                        # API 端口
WEB_ORIGIN=http://localhost:3011                 # 前端地址（CORS）
LIVEKIT_URL=ws://localhost:7880                  # LiveKit WebSocket 地址
LIVEKIT_API_KEY=devkey                           # LiveKit API Key
LIVEKIT_API_SECRET=devsecretdevsecretdevsec...   # LiveKit API Secret
DATABASE_URL=postgresql://...                    # PostgreSQL 连接串
REDIS_URL=redis://127.0.0.1:6379                # Redis 连接串
JWT_SECRET=replace-this-in-real-env              # JWT 密钥
```

---

### 3. 数据库模块 (packages/db)

#### 3.1 Prisma Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  email     String   @unique
  name      String?
}
```

#### 3.2 使用方法

```typescript
import { PrismaClient } from '@my-platform/db';

const prisma = new PrismaClient();
const user = await prisma.user.findUnique({
  where: { email: 'user@example.com' }
});
```

---

### 4. LiveKit 服务器 (infra/docker)

#### 4.1 Docker Compose 配置

```yaml
services:
  livekit:
    image: livekit/livekit-server:latest
    container_name: my-platform-livekit
    ports:
      - "7880:7880"   # WebSocket
      - "7881:7881"   # HTTP
      - "7882:7882/udp"  # WebRTC UDP
    volumes:
      - ./livekit.dev.yaml:/etc/livekit/livekit.dev.yaml:ro
    restart: unless-stopped
```

#### 4.2 LiveKit 配置 (livekit.dev.yaml)

```yaml
port: 7880

rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: false
  node_ip: 127.0.0.1

keys:
  devkey: devsecretdevsecretdevsecretdevsec
```

---

## 数据流与交互

### 场景一：创建房间

```
┌─────────┐          ┌──────────┐          ┌──────────────┐
│ 前端    │          │ NestJS   │          │ LiveKit      │
└────┬────┘          └─────┬────┘          └──────┬───────┘
     │                     │                       │
     │ 1. POST /rooms      │                       │
     │ { title: "我的直播" }│                       │
     ├────────────────────>│                       │
     │                     │ 2. createRoom()       │
     │                     ├──────────────────────>│
     │                     │                       │
     │                     │ 3. Room Created       │
     │                     │<──────────────────────┤
     │ 4. { item: {...} }  │                       │
     │<────────────────────┤                       │
     │                     │                       │
```

### 场景二：加入房间并推流

```
┌─────────┐     ┌──────────┐     ┌──────────────┐
│ 前端    │     │ NestJS   │     │ LiveKit      │
└────┬────┘     └─────┬────┘     └──────┬───────┘
     │                │                  │
     │ 1. POST /rooms/:id/join           │
     │ { identity: "user1" }             │
     ├───────────────>│                  │
     │                │ 2. 生成 JWT Token │
     │                │    (2小时有效)     │
     │                │                  │
     │ 3. { token, livekitUrl }          │
     │<───────────────┤                  │
     │                │                  │
     │ 4. room.connect(url, token)       │
     ├──────────────────────────────────>│
     │                │                  │
     │ 5. ConnectionStateChanged: Connected
     │<──────────────────────────────────┤
     │                │                  │
     │ 6. enableCamera/Microphone        │
     ├──────────────────────────────────>│
     │                │                  │
     │ 7. 推送媒体流 (WebRTC)             │
     │<═════════════════════════════════>│
     │                │                  │
```

### 场景三：观众加入并拉流

```
┌──────────┐    ┌──────────┐    ┌──────────────┐    ┌──────────┐
│ 观众前端  │    │ NestJS   │    │ LiveKit      │    │ 主播端   │
└─────┬────┘    └─────┬────┘    └──────┬───────┘    └─────┬────┘
      │               │                │                   │
      │ 1. POST /rooms/:id/join        │                   │
      ├──────────────>│                │                   │
      │               │ 2. 生成 Token   │                   │
      │ 3. { token }  │                │                   │
      │<──────────────┤                │                   │
      │               │                │                   │
      │ 4. room.connect(url, token)    │                   │
      ├───────────────────────────────>│                   │
      │               │                │                   │
      │ 5. ParticipantConnected Event  │                   │
      │               │                │<─────通知所有参与者──┤
      │               │                │                   │
      │ 6. TrackSubscribed (主播视频流)  │                   │
      │<───────────────────────────────┤                   │
      │               │                │                   │
      │ 7. 自动渲染视频  │                │                   │
      │               │                │                   │
```

---

## LiveKit 集成方案

### 1. 为什么选择 LiveKit？

| 特性 | 说明 |
|------|------|
| **低延迟** | 基于 WebRTC，延迟 < 300ms |
| **可扩展** | SFU 架构，单服务器支持数百人 |
| **开源** | Apache 2.0 许可 |
| **易用** | 提供 SDK 和 Cloud 版本 |
| **功能丰富** | 支持音视频、屏幕共享、录制、转码 |

### 2. 架构模式：SFU (Selective Forwarding Unit)

```
       主播 A                     观众 B                     观众 C
         │                          │                          │
         │ 推流 (上行)               │                          │
         ▼                          │                          │
    ┌─────────────────────────────────────────────────────────┐
    │              LiveKit Server (SFU)                        │
    │  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐       │
    │  │ Track 1│  │ Track 2│  │ Track 3│  │ Track 4│       │
    │  └────────┘  └────────┘  └────────┘  └────────┘       │
    └─────────────────────────────────────────────────────────┘
                          │                          │
                          │ 拉流 (下行)               │ 拉流 (下行)
                          ▼                          ▼
                       观众 B                       观众 C
```

**优势**：
- 主播只需上传一次流
- 服务器负责转发给所有观众
- 支持动态码率调整（simulcast）

### 3. Token 安全机制

```typescript
// 后端生成 JWT Token
const token = new AccessToken(apiKey, apiSecret, {
  identity: 'user123',
  ttl: '2h'  // 2小时后过期
});

token.addGrant({
  roomJoin: true,
  room: 'room-abc',
  canPublish: true,    // 主播：true，观众：false
  canSubscribe: true
});

// 前端使用 Token 连接
await room.connect(livekitUrl, await token.toJwt());
```

**安全特性**：
- Token 包含用户身份、房间 ID、权限
- Token 有过期时间
- 无法伪造（HMAC 签名）

### 4. 常用 API

#### 前端 (livekit-client)

```typescript
import { Room, RoomEvent, Track } from 'livekit-client';

const room = new Room();

// 监听事件
room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
  const element = track.attach();  // 返回 <video> 或 <audio>
  document.body.appendChild(element);
});

// 连接房间
await room.connect(livekitUrl, token);

// 开启摄像头和麦克风
await room.localParticipant.setCameraEnabled(true);
await room.localParticipant.setMicrophoneEnabled(true);

// 离开房间
room.disconnect();
```

#### 后端 (livekit-server-sdk)

```typescript
import { RoomServiceClient } from 'livekit-server-sdk';

const client = new RoomServiceClient(livekitUrl, apiKey, apiSecret);

// 列出所有房间
const rooms = await client.listRooms();

// 创建房间
await client.createRoom({
  name: 'room-123',
  maxParticipants: 50,
  emptyTimeout: 10 * 60  // 10分钟无人自动关闭
});

// 删除房间
await client.deleteRoom('room-123');
```

---

## 开发环境搭建

### 1. 环境要求

- **Node.js**: 22 LTS
- **pnpm**: 10+
- **Docker**: 最新版（用于 LiveKit）
- **PostgreSQL**: 14+（可选，数据库功能预留）
- **Redis**: 7+（可选，缓存功能预留）

### 2. 快速启动

```bash
# 1. 克隆项目（假设你已有项目）
cd my-platform

# 2. 安装 Node.js 22
source ~/.nvm/nvm.sh && nvm use 22

# 3. 安装依赖
pnpm install

# 4. 配置环境变量
cp .env.example .env
cp apps/web/.env.local.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env

# 5. 启动 LiveKit 服务器
pnpm livekit:up

# 6. 启动开发服务器（前端 + 后端）
pnpm dev
```

### 3. 访问地址

- **前端**: http://localhost:3011
- **后端 API**: http://localhost:3020
- **健康检查**: http://localhost:3020/health
- **房间列表 API**: http://localhost:3020/rooms

### 4. 常用命令

```bash
# 开发
pnpm dev              # 启动所有服务（前端 + 后端）
pnpm build            # 构建所有应用
pnpm typecheck        # 类型检查
pnpm lint             # 代码检查

# LiveKit
pnpm livekit:up       # 启动 LiveKit
pnpm livekit:down     # 停止 LiveKit
docker logs my-platform-livekit  # 查看 LiveKit 日志

# 数据库（如需使用）
cd packages/db
pnpm generate         # 生成 Prisma Client
pnpm migrate:dev      # 运行数据库迁移
```

---

## 生产部署架构

### 1. 推荐架构

```
                        Internet
                           │
                           ▼
                    ┌──────────────┐
                    │   Cloudflare │  CDN + DDoS 防护
                    └──────┬───────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
       ┌─────────────┐          ┌─────────────┐
       │  Next.js    │          │  NestJS API │
       │  (Vercel)   │          │  (Fly.io)   │
       └─────────────┘          └──────┬──────┘
                                       │
              ┌────────────────────────┼────────────────┐
              ▼                        ▼                ▼
       ┌─────────────┐        ┌─────────────┐  ┌─────────────┐
       │  LiveKit    │        │ PostgreSQL  │  │   Redis     │
       │  Server     │        │ (Supabase)  │  │ (Upstash)   │
       │ (自托管)     │        └─────────────┘  └─────────────┘
       └─────────────┘
```

### 2. 各服务部署方案

#### 前端 (Next.js)

**推荐平台**: Vercel / Netlify / Cloudflare Pages

```bash
# Vercel 部署
cd apps/web
vercel --prod

# 环境变量
NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com
NEXT_PUBLIC_LIVEKIT_URL=wss://livekit.yourdomain.com
```

#### 后端 (NestJS)

**推荐平台**: Fly.io / Railway / Render

```bash
# Fly.io 部署
cd apps/api
fly deploy

# 环境变量
PORT=3000
LIVEKIT_URL=wss://livekit.yourdomain.com
LIVEKIT_API_KEY=prod-key
LIVEKIT_API_SECRET=prod-secret
DATABASE_URL=postgresql://...
```

#### LiveKit 服务器

**方案 1: 自托管（推荐生产）**

使用 DigitalOcean / AWS EC2 / Hetzner

```bash
# 安装 LiveKit
curl -sSL https://get.livekit.io | bash

# 配置文件 /etc/livekit.yaml
port: 7880
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: true
  node_ip: YOUR_PUBLIC_IP

keys:
  your-api-key: your-api-secret

# 启动
livekit-server --config /etc/livekit.yaml
```

**方案 2: LiveKit Cloud（快速但收费）**

- 访问 https://livekit.io/cloud
- 获取 `wss://xxx.livekit.cloud` 和 API Key

#### 数据库

**推荐服务**:
- **PostgreSQL**: Supabase / Neon / Vercel Postgres
- **Redis**: Upstash / Redis Cloud

### 3. 域名与 SSL

```nginx
# Nginx 配置示例
server {
  listen 443 ssl;
  server_name livekit.yourdomain.com;

  ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:7880;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

### 4. 监控与日志

推荐工具：
- **应用监控**: Sentry / New Relic
- **日志**: Loki / Datadog
- **性能**: Prometheus + Grafana
- **LiveKit 监控**: LiveKit 内置 Prometheus 指标

---

## 扩展建议

### 1. 功能扩展

#### 1.1 用户认证系统

```typescript
// 使用 NextAuth.js
import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

export default NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET
    })
  ]
});
```

#### 1.2 直播录制

```typescript
// 后端启动录制
await roomService.updateRoomMetadata(roomId, {
  autoRecord: true,
  recordingOptions: {
    output: {
      s3: {
        bucket: 'my-recordings',
        region: 'us-west-2'
      }
    }
  }
});
```

#### 1.3 实时聊天

```typescript
// 使用 LiveKit Data Channel
await room.localParticipant.publishData(
  encoder.encode(JSON.stringify({
    type: 'chat',
    message: 'Hello!'
  })),
  DataPacket_Kind.RELIABLE
);

room.on(RoomEvent.DataReceived, (payload, participant) => {
  const data = JSON.parse(decoder.decode(payload));
  console.log(`${participant.identity}: ${data.message}`);
});
```

#### 1.4 屏幕共享

```typescript
await room.localParticipant.setScreenShareEnabled(true);
```

### 2. 性能优化

#### 2.1 Simulcast（多码率）

```typescript
const room = new Room({
  dynacast: true,          // 动态广播
  adaptiveStream: true,    // 自适应流
  videoCaptureDefaults: {
    resolution: {
      width: 1280,
      height: 720,
      frameRate: 30
    }
  }
});
```

#### 2.2 CDN 加速

- 使用 Cloudflare / AWS CloudFront 缓存静态资源
- LiveKit 配置 TURN 服务器提高连通率

### 3. 安全加固

```typescript
// API 限流
import rateLimit from 'express-rate-limit';

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
}));

// Token 权限细化
accessToken.addGrant({
  roomJoin: true,
  room: roomId,
  canPublish: userRole === 'host',  // 只有主播能推流
  canSubscribe: true,
  canPublishData: userRole !== 'guest'  // 游客不能发消息
});
```

### 4. 分析与统计

```typescript
// 监听房间状态
room.on(RoomEvent.RoomMetadataChanged, (metadata) => {
  analytics.track('room_metadata_changed', { metadata });
});

room.on(RoomEvent.ParticipantConnected, (participant) => {
  analytics.track('participant_joined', {
    roomId: room.name,
    participantId: participant.identity
  });
});
```

---

## 技术亮点总结

### ✨ 架构设计

1. **Monorepo 统一管理**：Turborepo + pnpm workspace
2. **类型安全**：全栈 TypeScript + Zod 验证
3. **模块化**：前后端分离，可独立部署
4. **可扩展**：预留数据库、Redis、共享包

### ✨ 实时通信

1. **低延迟直播**：WebRTC SFU 架构
2. **安全可靠**：JWT Token 鉴权
3. **开箱即用**：Docker Compose 一键启动

### ✨ 开发体验

1. **热重载**：Next.js Fast Refresh + tsx watch
2. **类型提示**：Prisma 自动生成类型
3. **统一构建**：Turborepo 增量构建

---

## 参考资源

- **LiveKit 官方文档**: https://docs.livekit.io
- **Next.js 文档**: https://nextjs.org/docs
- **NestJS 文档**: https://docs.nestjs.com
- **Prisma 文档**: https://www.prisma.io/docs
- **Turborepo 文档**: https://turbo.build/repo/docs

---

**文档版本**: v1.0
**更新时间**: 2026-02-09
**作者**: Claude Code + 项目团队
