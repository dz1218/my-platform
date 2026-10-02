# Companion V2 重构

## 差异与实施顺序

复用 `apps/server/internal/delivery` 的 PostgreSQL 持久化队列、租约、接管授权与版本栅栏；复用现有 `messages`、Go/Gin 鉴权、Next.js/Zustand 时间线。小说和 LiveKit 沿用现状。

1. `migrations/005_companion_v2.sql`、`006_companion_context.sql`、`007_context_enrichment.sql`、`delivery/batches.go`：增量扩展轮次缓冲、批次和条目；候选不写 messages；每条气泡独立事务提交，新消息/真人回复/配置变化取消剩余条目。
2. `apps/agent/src/agents/companion.ts`、`schemas/plan.ts`：单一 OpenAI Agents SDK Agent，替换 LangGraph；结构化 REPLY/SILENCE，Go 二次校验。
3. `delivery/proactive.go`：默认关闭的主动联系、来源机会、时区免打扰、频控与最终授权检查。
4. `delivery/memory.go`、Context Builder：记忆授权、来源、纠正删除、虚拟状态乐观锁。
5. HTTP/WS 与聊天设置：cursor 恢复、用户控制；保持原始消息和真实来源。

迁移保留 text 身份 ID 和 bigint 消息 ID；`reply_jobs.version` 对应任务 epoch，`turn_version` 对应输入版本，`settings_version` 对应权限版本。不另建重复的消息主存储。旧的单回复唯一索引继续保护历史数据，新批次以 reply_item_id 唯一索引防重。

部署前停止旧 worker，执行增量迁移，再同时更新 API、worker、Agent。迁移将旧的待投递单条候选取消并重新排队，避免旧代码绕过逐条校验。请勿混跑旧 worker。

以下记录实际实现、验证和部署边界。

## 已实现行为

- 原始输入逐条保存，同一 OPEN 轮次沿用 turn_id，输入推进 turn_version。debounce 默认 1 秒，最大窗口 8 秒；TIMEOUT 从最后一条消息重新起算，已有配置不覆盖，新会话默认 120 秒。
- 模型调用前检查版本，生成后检查版本；候选写 reply_batches/items，发送时按 conversation → job → batch/item 锁顺序逐条验证。最后一条才将普通轮次标记 ANSWERED，中途为 PARTIALLY_SENT。已提交消息不可撤销，未提交条目可取消。
- task lease 120 秒，模型总 deadline 100 秒；claim_token 拦截旧 worker。指数退避最多 300 秒，次数受 behavior.json 限制。
- 事务触发器写 message_outbox，现有数据库扫描 WebSocket 读取已提交消息和 outbox。没有单个全局 delivered 标记：各连接独立使用 bigint 消息 ID 作为 server sequence/cursor，避免一个连接消费掉其他连接的事件。
- 单主 Agents SDK Agent、REPLY/SILENCE、1–3 动态气泡。Go 与 Zod 双层检查空白、重复 key、长度、延迟。保留内部 SSE 整体候选契约，客户端仍只有 WebSocket。
- 主动联系默认关闭，每分钟扫描，八小时尝试预算；同会话/topic 和来源去重。用户在聊天设置中授权具体源消息与跟进时间；没有足够上下文可 SILENCE。每个气泡发送前重检 IANA 时区、跨日免打扰、成功批次频率、近期互动、输入 presence 和用户/真人策略。
- 用户可以关闭所有 AI 自动互动；真人 NEVER 拦截主动联系，其他托管模式仍需独立管理开关。输入 presence 每两秒最多更新一次、五秒过期，不会永久阻塞主动联系。
- 经用户确认的长期记忆支持来源标记、纠正与软删除。删除清除记忆正文和摘要，并取消旧候选；同来源 tombstone 防止旧内容重新插入。原始聊天历史仍保留，删除记忆不等于删除原始消息。
- 真人编辑的虚拟日常始终 fictional=true、48 小时内过期、使用 version 乐观锁。共享身份变更使相关会话的旧候选失效；Agent 无写入权限，无法覆盖真人修改。
- 上下文包括共享 AI/真人历史、关系阶段、摘要字段、最多 12 条授权记忆和未过期的虚拟状态。最近历史最多 40 条/12000 字，消息 provenance 明确传入。

## 用户与管理界面

聊天底部「陪伴设置与记忆」提供自动互动、主动关心、记忆授权、时区与免打扰；可保存/纠正/删除记忆，并授权一次跟进。真人管理端提供独立主动联系开关与虚拟日常编辑。整个身份可能由 AI 与真人共同参与，界面明确说明虚拟活动不代表现实行动。

所有接口沿用 `/api/v1` 的登录鉴权：

| 方法 | 路径 | 权限 / 用途 |
| --- | --- | --- |
| GET / PATCH | `/conversations/:id/preferences` | 会话用户修改自动互动、记忆、主动联系及免打扰；带 version |
| PATCH | `/conversations/:id/proactive-policy` | 仅已分配真人修改 allowProactiveAI；用户开关不能被覆盖 |
| POST | `/conversations/:id/followups` | 仅用户；sourceMessageId、topic、dueAt、expiresAt |
| GET / POST | `/conversations/:id/memories` | 仅用户；新增需来源，纠正需 id/version |
| POST | `/conversations/:id/memories/:memoryId/delete` | 仅用户，重复删除幂等 |
| GET / PATCH | `/conversations/:id/daily-state` | 已授权参与者读取，仅分配真人编辑；带 version |
| GET | `/conversations/:id/messages?after=ID` | 授权的断线补发，最多 200 条，按 ID 顺序 |

WebSocket 支持 `typing` 输入 presence，以及 `?after=ID` 重连恢复；前端合并快照与 message.created、按 ID 去重排序。

## 验证与部署范围

本次在无数据卷的独立 PostgreSQL 15 容器执行 `TEST_DATABASE_URL=... go test -race ./...`。每个集成测试进一步使用随机 schema；没有对现有业务库执行迁移。用例覆盖 V201/V202、V203/V205/V215 真实数据库竞争、V206/V207、V208/V210/V211 主动机会去重与 gate、V209 时区、V212/V214 状态冲突与记忆删除；原有鉴权、小说、接管、历史补发测试保留。

Agent 使用 SDK Mock 测试（无需模型密钥）和本机鉴权 HTTP 测试。Next.js/Agent 类型检查以及 Next.js 隔离目录构建可按下列命令重跑：

```bash
cd apps/server
TEST_DATABASE_URL='postgres://...专用测试库...' go test -race ./...
# 仓库根目录
pnpm --filter agent test
pnpm --filter agent build
pnpm --filter web typecheck
NEXT_BUILD_DIR=.next-v2-check pnpm --filter web build
```

本次实现以用户确认的记忆和授权跟进为入口。已实现授权后的持久化摘要/记忆候选任务（每 20 条消息触发、最多三次尝试），同一主 Agent 以 CONTEXT_UPDATE 入口整理；候选由用户确认，撤销授权/删除记忆使旧结果失效。虚拟日常按规则模板每日更新缓存，真人接管时暂停；真人编辑的状态即使过期也不会被自动覆盖。集中指标面板与真实模型人工质量评测尚未执行。真实供应商调用未在本次验证中运行，需要用实际端点验证模型对 JSON mode/JSON Schema 的支持。现有 LiveKit、小说未重构。

上线需先停止旧 worker、备份数据库，然后运行现有迁移命令并部署新版 API/worker/Agent/web。本次只交付工作区代码，未修改本地密钥、未部署或重启现有服务。

离线质量场景位于 `apps/agent/evals/companion-v2.json`，全部是合成场景，不含用户数据；用于后续真实模型人工抽样，不能视为已通过模型质量评测。
