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
- Companion V3 使用单次模型调用生成 REPLY/SILENCE、1–3 动态气泡：按场景、投入程度与细节决定展开程度，允许同一话题的自然反应和补充分开发送。最近四段已发送 AI 回复的表达摘要仅提醒重复，不指定气泡比例。Go 与 Zod 双层检查空白、重复 key、长度、延迟，内部 SSE 和客户端 WebSocket 契约不变。
- 主动联系默认关闭，每分钟扫描，八小时尝试预算；同会话/topic 和来源去重。用户在聊天设置中授权具体源消息与跟进时间；没有足够上下文可 SILENCE。每个气泡发送前重检 IANA 时区、跨日免打扰、成功批次频率、近期互动、输入 presence 和用户/真人策略。
- 用户可以关闭所有 AI 自动互动；真人 NEVER 拦截主动联系，其他托管模式仍需独立管理开关。输入 presence 每两秒最多更新一次、五秒过期，不会永久阻塞主动联系。
- 经用户确认的长期记忆支持来源标记、纠正与软删除。删除清除记忆正文和摘要，并取消旧候选；同来源 tombstone 防止旧内容重新插入。原始聊天历史仍保留，删除记忆不等于删除原始消息。
- 真人编辑的虚拟日常始终 fictional=true、48 小时内过期、使用 version 乐观锁。共享身份变更使相关会话的旧候选失效；Agent 无写入权限，无法覆盖真人修改。
- 上下文包括共享 AI/真人历史、关系阶段、摘要字段、最多 12 条授权记忆和未过期的虚拟状态。最近历史最多 40 条/12000 字，消息 provenance 明确传入。

## 用户与管理界面

普通聊天页不显示陪伴设置、托管策略或虚拟日常编辑，也不请求这些管理面板的数据。只有服务端确认当前用户继承了当前会话的 AI 身份（`canManage=true`）后，才显示托管策略、主动联系开关与虚拟日常编辑；不能根据页面路径或会话由真人接管就授予设置权限。权限撤销或读取权限失败时隐藏面板。旧版「陪伴设置与记忆」入口已移除，preferences 读写接口同样检查身份继承关系；记忆与跟进接口仍保留原有会话用户授权规则。注册选择页、唯一继承关系和双身份入口见 [身份继承与 AI 托管](autopilot.md)。旧版按会话分配不再授予身份管理权限。

所有接口沿用 `/api/v1` 的登录鉴权：

| 方法 | 路径 | 权限 / 用途 |
| --- | --- | --- |
| GET / PATCH | `/conversations/:id/preferences` | 仅当前身份继承者读取或修改自动互动、记忆、主动联系及免打扰；带 version |
| PATCH | `/conversations/:id/proactive-policy` | 仅当前身份继承者修改 allowProactiveAI；用户开关不能被覆盖 |
| POST | `/conversations/:id/followups` | 仅用户；sourceMessageId、topic、dueAt、expiresAt |
| GET / POST | `/conversations/:id/memories` | 仅用户；新增需来源，纠正需 id/version |
| POST | `/conversations/:id/memories/:memoryId/delete` | 仅用户，重复删除幂等 |
| GET / PATCH | `/conversations/:id/daily-state` | 已授权参与者读取，仅当前身份继承者编辑；带 version |
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


## 自然朋友式回复 V3

V3 不增加数据库迁移或公开 API。`replyPacing: "typing"` 随 `behavior.json` 的 `agent-actions-v4` 策略快照保存；缺少此字段的旧任务沿用模型建议延迟，已排定的条目不重新计算内容节奏。

- 首条目标等待为 `clamp(1000 + 12×未答用户字数 + 90×首条字数, 1800, 8000)` 毫秒，扣除自末条用户消息以来的时间，最少零。用户字数覆盖当前合并轮次内至本次触发消息的连续输入，包含补充消息；已经静默结束的旧轮次不计入。
- 后续气泡间隔为 `clamp(600 + 90×该条字数, 1200, 5000)` 毫秒，按 Unicode 字符计数。最多三条累计策略延迟不超过 18 秒。主动联系没有新的用户触发时间，以计划完成时作为首条计时起点。
- 每次实际投递在同一事务内把迟到时间顺延给剩余条目，保持相对间隔，避免 worker 重启或延迟造成连发。仍逐条检查输入版本、设置版本及真人权限。
- 生成前的有效用户输入状态可以推迟任务，但截止于原轮次的 8 秒合并上限；推迟不消耗模型重试次数，也不提前真人 TIMEOUT。接收新消息只清除该发送者的旧输入状态，幂等重发不清除后来的输入状态。
- 用户新消息或真人回复取消未发气泡；已经提交的消息作为历史保留。前端继续接收整条消息。

发布顺序：完成测试后，停止旧 worker，更新 Agent、API 的行为配置与 worker，再启动新版服务，避免混跑发送策略。V3 本身无迁移要求；其他版本的迁移仍按原部署流程执行。回退时恢复旧 Agent/worker 和行为配置；旧二进制会忽略新增配置字段，已经保存的内容与到期时间保留。

验证：Agent 类型检查和 Mock/HTTP 测试；专用 PostgreSQL 上的 `go test -race ./...`，覆盖节奏上下限、历史任务、输入状态、真人超时、部分发送后插话、重启与并发。真实模型对比工具及审阅要求见 [Agent README](../apps/agent/README.md)。历史章节中“未调用真实供应商”描述的是 V2 当时的验证，不代表 V3 的评测状态。

V3 本地验证记录（2026-10-03）：Node 22 下 Agent 12 项测试与构建通过；专用 PostgreSQL 15 的 Go 全量竞态测试通过，轮次边界修复后再次通过 delivery 全部测试。最终 deepseek-flash/JSON mode 评测 90 项首试 89 项有效，1 项截断 JSON 单独重试恢复；输出预算 2048 token，正文 500 字限制不变。已完成模型输出审阅，未进行人类盲评，不声称自然度评分已达标。报告位于 `apps/agent/test-results/companion-v3-release/comparison.html`，原始首试与重试均保留在 `results.jsonl`。本次未部署或重启已有业务服务，临时测试数据库已清理。
