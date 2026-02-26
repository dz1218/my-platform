# 实时直播平台 - 完整技术方案与实现指南 V2

> 从零搭建一个生产级的 Next.js + NestJS + LiveKit 直播平台

---

## 📋 目录

1. [技术栈选型与对比](#技术栈选型与对比)
2. [架构设计](#架构设计)
3. [数据库设计](#数据库设计)
4. [项目搭建步骤](#项目搭建步骤)
5. [核心功能实现](#核心功能实现)
6. [最佳实践](#最佳实践)
7. [部署方案](#部署方案)

---

## 技术栈选型与对比

### 改进版技术栈（推荐）

| 类别 | 技术 | 版本 | 优势 | 替代方案 |
|------|------|------|------|---------|
| **前端框架** | Next.js | 15+ | SSR、App Router、优化性能 | Remix, SvelteKit |
| **UI 组件** | shadcn/ui | latest | 无依赖、可定制、美观 | Ant Design, MUI |
| **样式方案** | Tailwind CSS | 3.4+ | 原子化 CSS、高效开发 | CSS Modules, Styled Components |
| **状态管理** | Zustand | 4+ | 轻量、简单、支持 SSR | Jotai, Redux Toolkit |
| **表单处理** | React Hook Form | 7+ | 性能好、验证强大 | Formik |
| **数据验证** | Zod | 3+ | TypeScript 原生、类型推导 | Yup, Joi |
| **后端框架** | NestJS | 11+ | 企业级、模块化、依赖注入 | Express, Fastify, Hono |
| **ORM** | Prisma | 6+ | 类型安全、迁移简单 | TypeORM, Drizzle |
| **数据库** | PostgreSQL | 16+ | 可靠、功能强大 | MySQL, MongoDB |
| **缓存** | Redis | 7+ | 高性能、支持多种数据结构 | Memcached |
| **实时通信** | LiveKit | latest | WebRTC SFU、开源 | Agora, Twilio |
| **WebSocket** | Socket.IO | 4+ | 实时聊天、通知 | ws, Pusher |
| **认证** | NextAuth.js v5 | 5+ | 多种登录方式、支持 Next.js 15 | Clerk, Auth0 |
| **API 文档** | Swagger/OpenAPI | 3.0 | 自动生成、交互式文档 | - |
| **日志** | Pino | 9+ | 高性能、结构化日志 | Winston |
| **测试** | Vitest + Playwright | latest | 快速、现代化 | Jest + Cypress |
| **Monorepo** | Turborepo | 2+ | 增量构建、缓存 | Nx, Lerna |
| **代码质量** | ESLint + Prettier | latest | 统一代码风格 | Biome |

### 为什么这样选择？

#### 前端改进

1. **shadcn/ui 替代纯 CSS**
   - ✅ 无运行时依赖，打包体积小
   - ✅ 基于 Radix UI，可访问性强
   - ✅ 可复制代码到项目，完全可控

2. **Zustand 替代 Context API**
   - ✅ 更简单的状态管理
   - ✅ 支持中间件（持久化、DevTools）
   - ✅ 性能更好（不会导致不必要的重渲染）

3. **React Hook Form 替代原生表单**
   - ✅ 减少重渲染
   - ✅ 内置验证
   - ✅ 与 Zod 完美集成

#### 后端改进

1. **Swagger 自动生成 API 文档**
   - ✅ 前端开发更方便
   - ✅ 减少沟通成本
   - ✅ 可直接测试 API

2. **Pino 替代 console.log**
   - ✅ 结构化日志，易于查询
   - ✅ 高性能（比 Winston 快 5 倍）
   - ✅ 生产环境友好

3. **完整的异常处理**
   - ✅ 全局异常过滤器
   - ✅ 统一错误格式
   - ✅ 错误追踪

---

## 架构设计

### 系统架构图

```
┌───────────────────────────────────────────────────────────────┐
│                        客户端层                                 │
├───────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │
│  │   Web 端     │  │  移动端 H5   │  │  管理后台    │           │
│  │  Next.js    │  │  Next.js    │  │  Next.js    │           │
│  │  + shadcn   │  │  + Tailwind │  │  + Charts   │           │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘           │
└─────────┼─────────────────┼─────────────────┼─────────────────┘
          │                 │                 │
          │ REST API        │ REST API        │ REST API
          │ + WebSocket     │ + WebSocket     │ + WebSocket
          ▼                 ▼                 ▼
┌───────────────────────────────────────────────────────────────┐
│                      应用层 (BFF)                               │
├───────────────────────────────────────────────────────────────┤
│                     Next.js API Routes                         │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  - 鉴权中间件                                          │     │
│  │  - 请求转发                                            │     │
│  │  - SSR 数据获取                                        │     │
│  └──────────────────────────────────────────────────────┘     │
└─────────────────────────────┬─────────────────────────────────┘
                              │
          ┌───────────────────┴───────────────────┐
          ▼                                       ▼
┌──────────────────────────┐        ┌──────────────────────────┐
│     核心服务层             │        │     实时通信层             │
├──────────────────────────┤        ├──────────────────────────┤
│     NestJS API Server     │        │    LiveKit Server        │
│                          │        │    + Socket.IO           │
│  ┌────────────────────┐  │        │                          │
│  │  Auth Module       │  │        │  ┌────────────────────┐  │
│  │  - JWT Strategy    │  │        │  │  Room Management   │  │
│  │  - Session         │  │        │  │  - Token Generate  │  │
│  └────────────────────┘  │        │  │  - Webhook Handle  │  │
│                          │        │  └────────────────────┘  │
│  ┌────────────────────┐  │        │                          │
│  │  User Module       │  │        │  ┌────────────────────┐  │
│  │  - CRUD            │  │        │  │  Media Processing  │  │
│  │  - Profile         │  │        │  │  - Recording       │  │
│  └────────────────────┘  │        │  │  - Transcoding     │  │
│                          │        │  └────────────────────┘  │
│  ┌────────────────────┐  │        │                          │
│  │  Room Module       │  │        │  ┌────────────────────┐  │
│  │  - Create/List     │  │        │  │  Chat System       │  │
│  │  - Permission      │  │        │  │  - Socket.IO       │  │
│  └────────────────────┘  │        │  │  - Message Queue   │  │
│                          │        │  └────────────────────┘  │
│  ┌────────────────────┐  │        └──────────────────────────┘
│  │  Analytics Module  │  │
│  │  - Statistics      │  │
│  │  - Reports         │  │
│  └────────────────────┘  │
└──────────┬───────────────┘
           │
    ┌──────┴──────┬──────────┬──────────┐
    ▼             ▼          ▼          ▼
┌─────────┐  ┌─────────┐  ┌────────┐  ┌────────┐
│PostgreSQL│  │  Redis  │  │  S3    │  │ Message│
│         │  │         │  │ Storage│  │ Queue  │
│ - Users │  │ - Cache │  │        │  │ (Bull) │
│ - Rooms │  │ - Session│  │ - Videos│  │        │
│ - Messages│ │ - Pub/Sub│ │ - Images│ │        │
└─────────┘  └─────────┘  └────────┘  └────────┘
```

### 技术架构分层

#### 1. 前端架构（Next.js）

```
app/
├── (auth)/                    # 认证路由组
│   ├── login/
│   └── register/
├── (dashboard)/               # 后台路由组
│   ├── layout.tsx             # 共享布局
│   ├── rooms/
│   └── analytics/
├── (public)/                  # 公开路由组
│   ├── page.tsx               # 首页
│   └── about/
├── live/
│   ├── page.tsx               # 房间列表
│   └── [roomId]/
│       └── page.tsx           # 房间详情
├── api/                       # API Routes (BFF)
│   ├── auth/
│   └── proxy/
└── layout.tsx                 # 根布局

components/
├── ui/                        # shadcn/ui 组件
│   ├── button.tsx
│   ├── dialog.tsx
│   └── ...
├── features/                  # 业务组件
│   ├── room/
│   │   ├── room-card.tsx
│   │   ├── room-list.tsx
│   │   └── room-player.tsx
│   └── chat/
│       ├── chat-panel.tsx
│       └── message-list.tsx
└── layout/                    # 布局组件
    ├── header.tsx
    └── sidebar.tsx

lib/
├── hooks/                     # 自定义 Hooks
│   ├── use-livekit.ts
│   └── use-socket.ts
├── stores/                    # Zustand Stores
│   ├── user-store.ts
│   └── room-store.ts
├── utils/                     # 工具函数
│   ├── api-client.ts
│   └── format.ts
└── validations/               # Zod Schemas
    └── room.schema.ts
```

#### 2. 后端架构（NestJS）

```
src/
├── main.ts                    # 入口文件
├── app.module.ts              # 根模块
├── common/                    # 公共模块
│   ├── decorators/            # 自定义装饰器
│   ├── filters/               # 异常过滤器
│   ├── guards/                # 守卫
│   ├── interceptors/          # 拦截器
│   ├── pipes/                 # 管道
│   └── dto/                   # 通用 DTO
├── config/                    # 配置
│   ├── database.config.ts
│   └── redis.config.ts
├── modules/
│   ├── auth/                  # 认证模块
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── strategies/
│   │   │   ├── jwt.strategy.ts
│   │   │   └── local.strategy.ts
│   │   └── dto/
│   ├── user/                  # 用户模块
│   │   ├── user.module.ts
│   │   ├── user.controller.ts
│   │   ├── user.service.ts
│   │   └── entities/
│   │       └── user.entity.ts
│   ├── room/                  # 房间模块
│   │   ├── room.module.ts
│   │   ├── room.controller.ts
│   │   ├── room.service.ts
│   │   ├── room.gateway.ts    # WebSocket
│   │   └── dto/
│   ├── livekit/               # LiveKit 模块
│   │   ├── livekit.module.ts
│   │   ├── livekit.service.ts
│   │   └── livekit.webhook.controller.ts
│   └── analytics/             # 分析模块
│       ├── analytics.module.ts
│       └── analytics.service.ts
└── prisma/                    # Prisma Client
    └── prisma.service.ts
```

---

## 数据库设计

### ER 图

```
┌─────────────────────┐
│       User          │
├─────────────────────┤
│ id (UUID)           │◄──┐
│ email (unique)      │   │
│ password_hash       │   │
│ name                │   │
│ avatar_url          │   │ 1:N
│ role (enum)         │   │
│ created_at          │   │
│ updated_at          │   │
└─────────────────────┘   │
                          │
                          │
┌─────────────────────┐   │
│       Room          │   │
├─────────────────────┤   │
│ id (UUID)           │   │
│ livekit_room_id     │   │
│ title               │   │
│ description         │   │
│ owner_id (FK)       │───┘
│ status (enum)       │
│ max_participants    │
│ is_public           │
│ thumbnail_url       │
│ started_at          │
│ ended_at            │
│ created_at          │
│ updated_at          │
└─────────────────────┘
         │
         │ 1:N
         ▼
┌─────────────────────┐
│   RoomParticipant   │
├─────────────────────┤
│ id (UUID)           │
│ room_id (FK)        │
│ user_id (FK)        │
│ role (enum)         │  host | moderator | viewer
│ joined_at           │
│ left_at             │
└─────────────────────┘


┌─────────────────────┐
│      Message        │
├─────────────────────┤
│ id (UUID)           │
│ room_id (FK)        │
│ user_id (FK)        │
│ content             │
│ type (enum)         │  text | image | system
│ created_at          │
└─────────────────────┘


┌─────────────────────┐
│    RoomRecording    │
├─────────────────────┤
│ id (UUID)           │
│ room_id (FK)        │
│ livekit_egress_id   │
│ file_url            │
│ duration            │
│ file_size           │
│ status (enum)       │
│ created_at          │
└─────────────────────┘


┌─────────────────────┐
│    RoomAnalytics    │
├─────────────────────┤
│ id (UUID)           │
│ room_id (FK)        │
│ peak_viewers        │
│ total_viewers       │
│ avg_watch_time      │
│ total_messages      │
│ date                │
└─────────────────────┘
```

### Prisma Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  USER
  ADMIN
  MODERATOR
}

enum RoomStatus {
  SCHEDULED  // 预定
  LIVE       // 直播中
  ENDED      // 已结束
  ARCHIVED   // 已归档
}

enum ParticipantRole {
  HOST       // 主播
  MODERATOR  // 管理员
  VIEWER     // 观众
}

enum MessageType {
  TEXT
  IMAGE
  SYSTEM
  GIFT
}

enum RecordingStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

model User {
  id            String   @id @default(cuid())
  email         String   @unique
  passwordHash  String   @map("password_hash")
  name          String?
  avatarUrl     String?  @map("avatar_url")
  role          UserRole @default(USER)
  emailVerified DateTime? @map("email_verified")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  // Relations
  ownedRooms    Room[]             @relation("RoomOwner")
  participations RoomParticipant[]
  messages      Message[]
  sessions      Session[]

  @@map("users")
}

model Session {
  id        String   @id @default(cuid())
  userId    String   @map("user_id")
  token     String   @unique
  expiresAt DateTime @map("expires_at")
  createdAt DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("sessions")
}

model Room {
  id               String     @id @default(cuid())
  livekitRoomId    String     @unique @map("livekit_room_id")
  title            String
  description      String?
  ownerId          String     @map("owner_id")
  status           RoomStatus @default(SCHEDULED)
  maxParticipants  Int        @default(50) @map("max_participants")
  isPublic         Boolean    @default(true) @map("is_public")
  thumbnailUrl     String?    @map("thumbnail_url")
  startedAt        DateTime?  @map("started_at")
  endedAt          DateTime?  @map("ended_at")
  createdAt        DateTime   @default(now()) @map("created_at")
  updatedAt        DateTime   @updatedAt @map("updated_at")

  // Relations
  owner        User                @relation("RoomOwner", fields: [ownerId], references: [id], onDelete: Cascade)
  participants RoomParticipant[]
  messages     Message[]
  recordings   RoomRecording[]
  analytics    RoomAnalytics[]

  @@index([ownerId])
  @@index([status])
  @@map("rooms")
}

model RoomParticipant {
  id       String          @id @default(cuid())
  roomId   String          @map("room_id")
  userId   String          @map("user_id")
  role     ParticipantRole @default(VIEWER)
  joinedAt DateTime        @default(now()) @map("joined_at")
  leftAt   DateTime?       @map("left_at")

  room Room @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([roomId, userId])
  @@index([roomId])
  @@index([userId])
  @@map("room_participants")
}

model Message {
  id        String      @id @default(cuid())
  roomId    String      @map("room_id")
  userId    String      @map("user_id")
  content   String
  type      MessageType @default(TEXT)
  metadata  Json?       // 额外信息（图片 URL、礼物信息等）
  createdAt DateTime    @default(now()) @map("created_at")

  room Room @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([roomId])
  @@index([userId])
  @@map("messages")
}

model RoomRecording {
  id              String          @id @default(cuid())
  roomId          String          @map("room_id")
  livekitEgressId String          @unique @map("livekit_egress_id")
  fileUrl         String?         @map("file_url")
  duration        Int?            // 秒
  fileSize        BigInt?         @map("file_size") // 字节
  status          RecordingStatus @default(PENDING)
  createdAt       DateTime        @default(now()) @map("created_at")
  updatedAt       DateTime        @updatedAt @map("updated_at")

  room Room @relation(fields: [roomId], references: [id], onDelete: Cascade)

  @@index([roomId])
  @@map("room_recordings")
}

model RoomAnalytics {
  id             String   @id @default(cuid())
  roomId         String   @map("room_id")
  peakViewers    Int      @default(0) @map("peak_viewers")
  totalViewers   Int      @default(0) @map("total_viewers")
  avgWatchTime   Int      @default(0) @map("avg_watch_time") // 秒
  totalMessages  Int      @default(0) @map("total_messages")
  date           DateTime @default(now())
  createdAt      DateTime @default(now()) @map("created_at")

  room Room @relation(fields: [roomId], references: [id], onDelete: Cascade)

  @@unique([roomId, date])
  @@index([roomId])
  @@map("room_analytics")
}
```

---

## 项目搭建步骤

### 第一步：初始化 Monorepo

```bash
# 1. 创建项目目录
mkdir live-platform && cd live-platform

# 2. 初始化 pnpm workspace
pnpm init

# 3. 创建 pnpm-workspace.yaml
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - 'apps/*'
  - 'packages/*'
EOF

# 4. 创建基础目录结构
mkdir -p apps packages infra

# 5. 安装 Turborepo
pnpm add -Dw turbo

# 6. 创建 turbo.json
cat > turbo.json << 'EOF'
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "build/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "typecheck": {
      "dependsOn": ["^typecheck"]
    },
    "test": {
      "dependsOn": ["^build"]
    }
  }
}
EOF

# 7. 更新根 package.json
cat > package.json << 'EOF'
{
  "name": "live-platform",
  "private": true,
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test"
  },
  "devDependencies": {
    "turbo": "^2.5.6",
    "typescript": "^5.9.2"
  },
  "packageManager": "pnpm@10.10.0",
  "engines": {
    "node": ">=20"
  }
}
EOF
```

### 第二步：创建共享包

#### 2.1 数据库包 (packages/db)

```bash
cd packages
mkdir db && cd db
pnpm init

# 安装依赖
pnpm add @prisma/client
pnpm add -D prisma

# 初始化 Prisma
npx prisma init
```

创建 `packages/db/package.json`:

```json
{
  "name": "@live-platform/db",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "generate": "prisma generate",
    "migrate:dev": "prisma migrate dev",
    "migrate:deploy": "prisma migrate deploy",
    "studio": "prisma studio",
    "seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "@prisma/client": "^6.19.0"
  },
  "devDependencies": {
    "prisma": "^6.19.0",
    "tsx": "^4.20.5"
  }
}
```

创建 `packages/db/src/index.ts`:

```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export * from '@prisma/client';
```

#### 2.2 共享类型包 (packages/shared)

```bash
cd packages
mkdir shared && cd shared
pnpm init
```

创建 `packages/shared/package.json`:

```json
{
  "name": "@live-platform/shared",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.9.2"
  },
  "dependencies": {
    "zod": "^3.24.1"
  }
}
```

创建 `packages/shared/src/index.ts`:

```typescript
export * from './types';
export * from './schemas';
export * from './constants';
```

创建 `packages/shared/src/types.ts`:

```typescript
export type UserRole = 'USER' | 'ADMIN' | 'MODERATOR';
export type RoomStatus = 'SCHEDULED' | 'LIVE' | 'ENDED' | 'ARCHIVED';
export type ParticipantRole = 'HOST' | 'MODERATOR' | 'VIEWER';
export type MessageType = 'TEXT' | 'IMAGE' | 'SYSTEM' | 'GIFT';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

创建 `packages/shared/src/schemas.ts`:

```typescript
import { z } from 'zod';

// Room schemas
export const createRoomSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().default(true),
  maxParticipants: z.number().min(2).max(1000).default(50),
});

export const joinRoomSchema = z.object({
  identity: z.string().min(2).max(80).regex(/^\S+$/),
  name: z.string().min(1).max(80).optional(),
});

// Auth schemas
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  name: z.string().min(2).max(50).optional(),
});

// Message schema
export const sendMessageSchema = z.object({
  content: z.string().min(1).max(1000),
  type: z.enum(['TEXT', 'IMAGE', 'SYSTEM', 'GIFT']).default('TEXT'),
});

export type CreateRoomDto = z.infer<typeof createRoomSchema>;
export type JoinRoomDto = z.infer<typeof joinRoomSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type RegisterDto = z.infer<typeof registerSchema>;
export type SendMessageDto = z.infer<typeof sendMessageSchema>;
```

创建 `packages/shared/src/constants.ts`:

```typescript
export const ROOM_STATUS = {
  SCHEDULED: 'SCHEDULED',
  LIVE: 'LIVE',
  ENDED: 'ENDED',
  ARCHIVED: 'ARCHIVED',
} as const;

export const USER_ROLE = {
  USER: 'USER',
  ADMIN: 'ADMIN',
  MODERATOR: 'MODERATOR',
} as const;

export const PARTICIPANT_ROLE = {
  HOST: 'HOST',
  MODERATOR: 'MODERATOR',
  VIEWER: 'VIEWER',
} as const;

export const MESSAGE_TYPE = {
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
  SYSTEM: 'SYSTEM',
  GIFT: 'GIFT',
} as const;

export const API_ERRORS = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
```

### 第三步：创建后端应用 (apps/api)

```bash
cd apps
npx @nestjs/cli new api
cd api
```

安装依赖:

```bash
# 核心依赖
pnpm add @nestjs/common@^11 @nestjs/core@^11 @nestjs/platform-express@^11
pnpm add @nestjs/config @nestjs/jwt @nestjs/passport @nestjs/swagger
pnpm add @nestjs/websockets @nestjs/platform-socket.io

# LiveKit
pnpm add livekit-server-sdk

# 数据库 & 验证
pnpm add @prisma/client bcrypt class-validator class-transformer
pnpm add zod

# 日志
pnpm add nestjs-pino pino-http pino-pretty

# Redis
pnpm add @nestjs/cache-manager cache-manager cache-manager-redis-yet redis

# 工具
pnpm add dayjs uuid

# 开发依赖
pnpm add -D @types/node @types/bcrypt @types/uuid
pnpm add -D tsx prisma

# 添加本地包
pnpm add @live-platform/db@workspace:* @live-platform/shared@workspace:*
```

创建核心模块结构（详细代码见下一节）

### 第四步：创建前端应用 (apps/web)

```bash
cd apps
npx create-next-app@latest web --typescript --tailwind --app --use-pnpm

cd web
```

安装依赖:

```bash
# UI 组件
npx shadcn@latest init

# LiveKit
pnpm add livekit-client @livekit/components-react

# 状态管理
pnpm add zustand

# 表单
pnpm add react-hook-form @hookform/resolvers zod

# WebSocket
pnpm add socket.io-client

# 认证
pnpm add next-auth@beta

# 工具
pnpm add dayjs clsx tailwind-merge

# 开发依赖
pnpm add -D @types/node

# 添加本地包
pnpm add @live-platform/shared@workspace:*
```

安装 shadcn/ui 组件:

```bash
npx shadcn@latest add button
npx shadcn@latest add card
npx shadcn@latest add dialog
npx shadcn@latest add input
npx shadcn@latest add label
npx shadcn@latest add avatar
npx shadcn@latest add badge
npx shadcn@latest add toast
npx shadcn@latest add dropdown-menu
npx shadcn@latest add sheet
npx shadcn@latest add tabs
npx shadcn@latest add form
```

### 第五步：配置环境变量

创建 `.env.example`:

```bash
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/live_platform"

# Redis
REDIS_URL="redis://localhost:6379"

# LiveKit
LIVEKIT_URL="ws://localhost:7880"
LIVEKIT_API_KEY="devkey"
LIVEKIT_API_SECRET="secret"

# Auth
JWT_SECRET="your-super-secret-jwt-key-change-in-production"
NEXTAUTH_SECRET="your-nextauth-secret"
NEXTAUTH_URL="http://localhost:3000"

# App
NODE_ENV="development"
API_PORT=3001
WEB_PORT=3000
WEB_ORIGIN="http://localhost:3000"
API_URL="http://localhost:3001"
```

---

## 核心功能实现

### 1. 后端核心代码

#### 1.1 认证模块 (apps/api/src/modules/auth)

`auth.service.ts`:

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import type { LoginDto, RegisterDto } from '@live-platform/shared';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    // 检查邮箱是否已存在
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new UnauthorizedException('Email already exists');
    }

    // 哈希密码
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // 创建用户
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    // 生成 JWT
    const token = await this.generateToken(user.id);

    return {
      user,
      accessToken: token,
    };
  }

  async login(dto: LoginDto) {
    // 查找用户
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 验证密码
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 生成 JWT
    const token = await this.generateToken(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      accessToken: token,
    };
  }

  async validateUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatarUrl: true,
      },
    });
  }

  private async generateToken(userId: string): Promise<string> {
    return this.jwtService.sign({ sub: userId });
  }
}
```

`jwt.strategy.ts`:

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private authService: AuthService,
    configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.get('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string }) {
    const user = await this.authService.validateUser(payload.sub);
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
```

#### 1.2 房间模块 (apps/api/src/modules/room)

`room.service.ts`:

```typescript
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { LiveKitService } from '../livekit/livekit.service';
import type { CreateRoomDto, JoinRoomDto } from '@live-platform/shared';
import { RoomStatus, ParticipantRole } from '@prisma/client';

@Injectable()
export class RoomService {
  constructor(
    private prisma: PrismaService,
    private livekitService: LiveKitService,
  ) {}

  async createRoom(userId: string, dto: CreateRoomDto) {
    // 生成 LiveKit 房间 ID
    const livekitRoomId = `room-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // 在 LiveKit 创建房间
    await this.livekitService.createRoom(livekitRoomId, {
      maxParticipants: dto.maxParticipants,
    });

    // 在数据库创建记录
    const room = await this.prisma.room.create({
      data: {
        livekitRoomId,
        title: dto.title,
        description: dto.description,
        ownerId: userId,
        maxParticipants: dto.maxParticipants,
        isPublic: dto.isPublic,
        status: RoomStatus.SCHEDULED,
      },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    });

    return room;
  }

  async listRooms(params: {
    page?: number;
    limit?: number;
    status?: RoomStatus;
  }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where = {
      isPublic: true,
      ...(params.status && { status: params.status }),
    };

    const [rooms, total] = await Promise.all([
      this.prisma.room.findMany({
        where,
        skip,
        take: limit,
        include: {
          owner: {
            select: {
              id: true,
              name: true,
              avatarUrl: true,
            },
          },
          _count: {
            select: {
              participants: {
                where: { leftAt: null },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.room.count({ where }),
    ]);

    return {
      items: rooms.map((room) => ({
        ...room,
        currentViewers: room._count.participants,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getRoomById(roomId: string) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
          },
        },
        _count: {
          select: {
            participants: {
              where: { leftAt: null },
            },
          },
        },
      },
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    return {
      ...room,
      currentViewers: room._count.participants,
    };
  }

  async joinRoom(userId: string, roomId: string, dto: JoinRoomDto) {
    // 检查房间是否存在
    const room = await this.getRoomById(roomId);

    // 检查是否是房主
    const isOwner = room.ownerId === userId;
    const role = isOwner ? ParticipantRole.HOST : ParticipantRole.VIEWER;

    // 记录参与者
    await this.prisma.roomParticipant.upsert({
      where: {
        roomId_userId: {
          roomId: room.id,
          userId,
        },
      },
      create: {
        roomId: room.id,
        userId,
        role,
      },
      update: {
        leftAt: null,
      },
    });

    // 生成 LiveKit Token
    const token = await this.livekitService.generateToken({
      roomId: room.livekitRoomId,
      identity: dto.identity,
      name: dto.name || dto.identity,
      canPublish: isOwner,
      canSubscribe: true,
    });

    // 如果是第一次有人加入，更新房间状态为 LIVE
    if (room.status === RoomStatus.SCHEDULED) {
      await this.prisma.room.update({
        where: { id: room.id },
        data: {
          status: RoomStatus.LIVE,
          startedAt: new Date(),
        },
      });
    }

    return {
      token,
      livekitUrl: this.livekitService.getLivekitUrl(),
      room: {
        id: room.id,
        livekitRoomId: room.livekitRoomId,
        title: room.title,
      },
    };
  }

  async leaveRoom(userId: string, roomId: string) {
    await this.prisma.roomParticipant.updateMany({
      where: {
        roomId,
        userId,
        leftAt: null,
      },
      data: {
        leftAt: new Date(),
      },
    });
  }

  async deleteRoom(userId: string, roomId: string) {
    const room = await this.getRoomById(roomId);

    // 只有房主可以删除房间
    if (room.ownerId !== userId) {
      throw new ForbiddenException('Only room owner can delete the room');
    }

    // 在 LiveKit 删除房间
    await this.livekitService.deleteRoom(room.livekitRoomId);

    // 在数据库删除
    await this.prisma.room.delete({
      where: { id: roomId },
    });

    return { success: true };
  }
}
```

#### 1.3 LiveKit 服务 (apps/api/src/modules/livekit)

`livekit.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

@Injectable()
export class LiveKitService {
  private roomService: RoomServiceClient;
  private livekitUrl: string;
  private apiKey: string;
  private apiSecret: string;

  constructor(private config: ConfigService) {
    this.livekitUrl = this.config.get('LIVEKIT_URL')!;
    this.apiKey = this.config.get('LIVEKIT_API_KEY')!;
    this.apiSecret = this.config.get('LIVEKIT_API_SECRET')!;

    const httpUrl = this.livekitUrl.replace('ws://', 'http://').replace('wss://', 'https://');
    this.roomService = new RoomServiceClient(httpUrl, this.apiKey, this.apiSecret);
  }

  async createRoom(roomId: string, options?: { maxParticipants?: number }) {
    return this.roomService.createRoom({
      name: roomId,
      maxParticipants: options?.maxParticipants || 50,
      emptyTimeout: 10 * 60, // 10 分钟无人自动关闭
    });
  }

  async deleteRoom(roomId: string) {
    return this.roomService.deleteRoom(roomId);
  }

  async listRooms() {
    return this.roomService.listRooms();
  }

  async generateToken(params: {
    roomId: string;
    identity: string;
    name?: string;
    canPublish?: boolean;
    canSubscribe?: boolean;
  }) {
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: params.identity,
      name: params.name || params.identity,
      ttl: '2h',
    });

    token.addGrant({
      roomJoin: true,
      room: params.roomId,
      canPublish: params.canPublish ?? false,
      canSubscribe: params.canSubscribe ?? true,
      canPublishData: true,
    });

    return token.toJwt();
  }

  getLivekitUrl() {
    return this.livekitUrl;
  }
}
```

### 2. 前端核心代码

#### 2.1 LiveKit Hook (apps/web/src/lib/hooks/use-livekit.ts)

```typescript
'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  ConnectionState,
  LocalParticipant,
  RemoteParticipant,
  RemoteTrack,
} from 'livekit-client';

interface UseLiveKitOptions {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
}

export function useLiveKit(options: UseLiveKitOptions = {}) {
  const [room, setRoom] = useState<Room | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.Disconnected
  );
  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
  const [localParticipant, setLocalParticipant] = useState<LocalParticipant | null>(null);

  const roomRef = useRef<Room | null>(null);

  useEffect(() => {
    return () => {
      // 清理
      if (roomRef.current) {
        roomRef.current.disconnect();
      }
    };
  }, []);

  const connect = async (url: string, token: string) => {
    try {
      const newRoom = new Room();
      roomRef.current = newRoom;

      // 监听连接状态
      newRoom.on(RoomEvent.ConnectionStateChanged, (state) => {
        setConnectionState(state);
        if (state === ConnectionState.Connected) {
          options.onConnected?.();
        } else if (state === ConnectionState.Disconnected) {
          options.onDisconnected?.();
        }
      });

      // 监听参与者变化
      newRoom.on(RoomEvent.ParticipantConnected, () => {
        setParticipants(Array.from(newRoom.remoteParticipants.values()));
      });

      newRoom.on(RoomEvent.ParticipantDisconnected, () => {
        setParticipants(Array.from(newRoom.remoteParticipants.values()));
      });

      // 连接房间
      await newRoom.connect(url, token);

      setRoom(newRoom);
      setLocalParticipant(newRoom.localParticipant);
      setParticipants(Array.from(newRoom.remoteParticipants.values()));
    } catch (error) {
      options.onError?.(error as Error);
      throw error;
    }
  };

  const disconnect = () => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
      setRoom(null);
      setConnectionState(ConnectionState.Disconnected);
      setParticipants([]);
    }
  };

  const enableCamera = async () => {
    if (!room) return;
    await room.localParticipant.setCameraEnabled(true);
  };

  const disableCamera = async () => {
    if (!room) return;
    await room.localParticipant.setCameraEnabled(false);
  };

  const enableMicrophone = async () => {
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(true);
  };

  const disableMicrophone = async () => {
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(false);
  };

  return {
    room,
    connectionState,
    participants,
    localParticipant,
    isConnected: connectionState === ConnectionState.Connected,
    connect,
    disconnect,
    enableCamera,
    disableCamera,
    enableMicrophone,
    disableMicrophone,
  };
}
```

#### 2.2 房间组件 (apps/web/src/components/features/room/room-player.tsx)

```typescript
'use client';

import { useEffect, useRef } from 'react';
import { useLiveKit } from '@/lib/hooks/use-livekit';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Video, VideoOff, Mic, MicOff } from 'lucide-react';

interface RoomPlayerProps {
  roomId: string;
  livekitUrl: string;
  token: string;
}

export function RoomPlayer({ roomId, livekitUrl, token }: RoomPlayerProps) {
  const {
    room,
    connectionState,
    participants,
    localParticipant,
    isConnected,
    connect,
    disconnect,
    enableCamera,
    disableCamera,
    enableMicrophone,
    disableMicrophone,
  } = useLiveKit({
    onConnected: () => console.log('Connected to room'),
    onDisconnected: () => console.log('Disconnected from room'),
    onError: (error) => console.error('LiveKit error:', error),
  });

  const localVideoRef = useRef<HTMLDivElement>(null);
  const remoteVideosRef = useRef<HTMLDivElement>(null);

  // 自动连接
  useEffect(() => {
    connect(livekitUrl, token);
    return () => disconnect();
  }, [livekitUrl, token]);

  // 渲染本地视频
  useEffect(() => {
    if (!localParticipant || !localVideoRef.current) return;

    const videoTrack = Array.from(localParticipant.videoTrackPublications.values()).find(
      (pub) => pub.track
    )?.track;

    if (videoTrack) {
      const element = videoTrack.attach();
      element.style.width = '100%';
      element.style.borderRadius = '8px';
      localVideoRef.current.innerHTML = '';
      localVideoRef.current.appendChild(element);
    }

    return () => {
      if (videoTrack) {
        videoTrack.detach();
      }
    };
  }, [localParticipant]);

  // 渲染远端视频
  useEffect(() => {
    if (!remoteVideosRef.current) return;

    remoteVideosRef.current.innerHTML = '';

    participants.forEach((participant) => {
      participant.videoTrackPublications.forEach((publication) => {
        if (publication.track) {
          const element = publication.track.attach();
          element.style.width = '100%';
          element.style.borderRadius = '8px';

          const container = document.createElement('div');
          container.className = 'relative';
          container.appendChild(element);

          const label = document.createElement('div');
          label.className = 'absolute bottom-2 left-2 bg-black/50 text-white px-2 py-1 rounded text-sm';
          label.textContent = participant.identity;
          container.appendChild(label);

          remoteVideosRef.current?.appendChild(container);
        }
      });
    });
  }, [participants]);

  return (
    <div className="space-y-4">
      {/* 状态显示 */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">连接状态</p>
            <p className="font-medium">{connectionState}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">参与者</p>
            <p className="font-medium">{participants.length + 1}</p>
          </div>
        </div>
      </Card>

      {/* 本地预览 */}
      <Card className="p-4">
        <h3 className="font-semibold mb-2">本地预览</h3>
        <div ref={localVideoRef} className="bg-black rounded-lg aspect-video" />
        <div className="flex gap-2 mt-4">
          <Button onClick={enableCamera} disabled={!isConnected}>
            <Video className="w-4 h-4 mr-2" />
            开启摄像头
          </Button>
          <Button onClick={disableCamera} variant="outline" disabled={!isConnected}>
            <VideoOff className="w-4 h-4 mr-2" />
            关闭摄像头
          </Button>
          <Button onClick={enableMicrophone} disabled={!isConnected}>
            <Mic className="w-4 h-4 mr-2" />
            开启麦克风
          </Button>
          <Button onClick={disableMicrophone} variant="outline" disabled={!isConnected}>
            <MicOff className="w-4 h-4 mr-2" />
            关闭麦克风
          </Button>
        </div>
      </Card>

      {/* 远端视频 */}
      <Card className="p-4">
        <h3 className="font-semibold mb-2">远端参与者 ({participants.length})</h3>
        <div
          ref={remoteVideosRef}
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        />
      </Card>
    </div>
  );
}
```

---

## 最佳实践

### 1. 代码规范

#### ESLint 配置

创建 `.eslintrc.json`:

```json
{
  "extends": [
    "next/core-web-vitals",
    "plugin:@typescript-eslint/recommended"
  ],
  "rules": {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "no-console": ["warn", { "allow": ["warn", "error"] }]
  }
}
```

#### Prettier 配置

创建 `.prettierrc`:

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2
}
```

### 2. Git Hooks (Husky)

```bash
pnpm add -Dw husky lint-staged

# 初始化 husky
npx husky init

# 创建 pre-commit hook
echo "pnpm lint-staged" > .husky/pre-commit
```

创建 `.lintstagedrc.js`:

```javascript
module.exports = {
  '*.{js,jsx,ts,tsx}': ['eslint --fix', 'prettier --write'],
  '*.{json,md}': ['prettier --write'],
};
```

### 3. 错误处理

#### 全局异常过滤器 (NestJS)

```typescript
// apps/api/src/common/filters/http-exception.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: any;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message = typeof exceptionResponse === 'string'
        ? exceptionResponse
        : (exceptionResponse as any).message;
      details = (exceptionResponse as any).details;
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    response.status(status).json({
      success: false,
      error: {
        code: HttpStatus[status],
        message,
        details,
      },
      timestamp: new Date().toISOString(),
    });
  }
}
```

在 `main.ts` 中注册:

```typescript
app.useGlobalFilters(new HttpExceptionFilter());
```

### 4. 日志系统

```typescript
// apps/api/src/main.ts
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  // ...
}
```

```typescript
// apps/api/src/app.module.ts
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV === 'development'
            ? {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                },
              }
            : undefined,
      },
    }),
    // ...
  ],
})
export class AppModule {}
```

### 5. 性能优化

#### 前端优化

1. **图片优化**: 使用 Next.js Image 组件
2. **代码分割**: 使用动态导入
3. **缓存策略**: 合理使用 React Query
4. **虚拟滚动**: 长列表使用 `react-virtual`

#### 后端优化

1. **数据库索引**: 在常用查询字段添加索引
2. **Redis 缓存**: 缓存热点数据
3. **连接池**: 配置合理的数据库连接池
4. **批量操作**: 使用 Prisma 的批量操作

---

## 部署方案

### Docker Compose 一键部署

创建 `docker-compose.yml`:

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:16-alpine
    container_name: live-platform-postgres
    environment:
      POSTGRES_DB: live_platform
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    container_name: live-platform-redis
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data

  livekit:
    image: livekit/livekit-server:latest
    container_name: live-platform-livekit
    command:
      - --config
      - /etc/livekit/livekit.yaml
    ports:
      - '7880:7880'
      - '7881:7881'
      - '7882:7882/udp'
    volumes:
      - ./infra/livekit.yaml:/etc/livekit/livekit.yaml:ro

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    container_name: live-platform-api
    depends_on:
      - postgres
      - redis
      - livekit
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/live_platform
      REDIS_URL: redis://redis:6379
      LIVEKIT_URL: ws://livekit:7880
    ports:
      - '3001:3001'

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    container_name: live-platform-web
    depends_on:
      - api
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:3001
      NEXT_PUBLIC_LIVEKIT_URL: ws://localhost:7880
    ports:
      - '3000:3000'

volumes:
  postgres_data:
  redis_data:
```

### Dockerfile (API)

```dockerfile
# apps/api/Dockerfile
FROM node:20-alpine AS base
RUN npm install -g pnpm@10

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build --filter=api

FROM base AS runner
WORKDIR /app
ENV NODE_ENV production
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3001
CMD ["node", "dist/main.js"]
```

### 启动命令

```bash
# 开发环境
docker-compose up -d postgres redis livekit
pnpm dev

# 生产环境
docker-compose up -d
```

---

## 总结

这份技术方案相比之前的改进：

### ✨ 核心改进

1. **更完善的数据库设计**: 用户、房间、参与者、消息、录制、分析表
2. **更好的前端体验**: shadcn/ui + Tailwind + Zustand
3. **更强的类型安全**: 完整的 Prisma schema + Zod 验证
4. **更规范的代码**: ESLint + Prettier + Husky
5. **更好的日志**: Pino 结构化日志
6. **更完整的认证**: NextAuth.js v5
7. **更详细的文档**: Swagger API 文档

### 📦 可直接使用的代码

- ✅ 完整的 Prisma Schema
- ✅ NestJS 认证、房间、LiveKit 模块
- ✅ React Hook (useLiveKit)
- ✅ 房间播放器组件
- ✅ Docker Compose 配置

### 🚀 下一步

1. 按照"项目搭建步骤"从零开始创建项目
2. 复制代码到对应文件
3. 配置环境变量
4. 运行 `docker-compose up -d` 启动基础设施
5. 运行 `pnpm dev` 启动开发服务器

如有任何问题，随时问我！
