# 真人接管与 AI 托管

> 本文记录旧版设计；当前 V2 实现与升级要求见 [Companion V2](companion-v2.md)。

## 使用

聊天用户仍在原会话发送消息。获得会话授权的真人通过「我的 → 真人接管」或 `/operator` 打开管理端，点击「接管会话」后可用陪伴身份回复。双方共用消息历史，聊天端统一显示身份名字；管理端显示 AI / 真人来源，服务端保留真实来源与审计。

- AI 运营：默认自动回复，接管后的托管策略暂不生效。
- 真人接管 + NEVER：不自动回复。
- 真人接管 + TIMEOUT：最后一条用户消息后等待 15 / 30 / 60 / 180 / 300 / 600 秒。
- 真人接管 + ALWAYS：按服务端 debounce 窗口合并新消息后自动回复，真人仍可插入回复。

真人回复取消当前尚未提交的 AI 任务。已经提交的 AI 消息保留在历史中。
切换设置会取消旧草稿；如果最新消息仍为用户消息，按新策略重新安排任务，超时起点仍是这条消息的保存时间。相同设置重试不增加版本。结束真人接管会恢复 AI 运营。

## 部署与授权

部署新版 API、worker、Agent 和 web，并执行 `pnpm db:migrate`（API/worker 启动时也会执行迁移）。迁移 `004_autopilot.sql` 为已有会话设置 AI 运营，不改变已有消息或账号；历史来源从既有 sender_type / driver_type 读取。滚动升级前停止旧 worker，避免旧代码绕过新的提交校验。

V1 没有公开的自助授权接口。运维人员通过具有数据库权限的服务器终端分配会话；actor 为执行操作的管理员账号 ID，operator 为已注册的接管账号 ID。此命令本身以服务器访问权限作为管理权限，不对外提供 HTTP 调用。

```bash
cd apps/server
# 分配或更换真人；不能将聊天用户设为对方身份的接管人。
go run ./cmd/takeover -conversation CONVERSATION_ID -operator OPERATOR_USER_ID -actor ADMIN_USER_ID
# 撤销授权。
go run ./cmd/takeover -conversation CONVERSATION_ID -revoke -actor ADMIN_USER_ID
```

命令读取 server/root `.env` 的 DATABASE_URL、BEHAVIOR_CONFIG；不会调用模型。分配/撤销与会话版本推进、任务失效、审计在同一事务完成。关系改变时恢复 AI 运营、接管后的策略重置为 NEVER，并按 AI 策略重新安排尚未回复的用户消息。新接管人需主动接管；旧接管人立即失去发送/设置权限，已建立的 WebSocket 在下次同步时关闭。不要直接修改接管表，避免绕过版本和审计。

## 接口

全部在 `/api/v1` 下，使用现有登录鉴权。消息 POST 与 WebSocket send 均通过同一 delivery.Service。客户端无权指定 source、actor 或聊天身份。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | /operator/conversations | 当前真人被分配的会话 |
| GET | /conversations/:id/auto-reply | 当前设置、版本及 canManage |
| PATCH | /conversations/:id/auto-reply | `{ "mode": "TIMEOUT", "delaySeconds": 60 }` |
| POST | /conversations/:id/takeover | `{ "ownerType": "HUMAN" }` 接管，`AI` 结束接管 |
| POST | /conversations/:id/messages | `{ "content": "...", "requestId": "..." }`，来源由服务端确定 |
| GET | /conversations/:id/messages | 双方共用的历史与 source |

设置/接管只允许被分配的真人修改。已分配但尚未接管时可以查看历史和预设策略，不能以真人身份发送。普通聊天用户不能给自己授予接管权限。

WebSocket 保留 `accepted`、`history` 快照，并增加 `message.created` 和 `auto_reply.settings_updated`。Go 每秒扫描已提交状态，消息表作为可恢复的事件来源；没有在提交前推送。在线事件按消息 ID 分批追赶，不受最新 50 条历史窗口限制。重连初始化最新历史，更早的记录由历史接口翻页恢复。V1 仍为数据库扫描推送，未引入 Redis 发布订阅。

## 一致性

沿用 `reply_jobs` 的单会话持久化任务槽，而不是另建一套队列。`version + claim_token` 保护任务租约，`settings_version + turn_version` 保护配置和会话轮次。每条新的用户消息刷新任务并推进轮次；重复 requestId 仅确认原消息。真人消息保留身份 sender 和真实 actor_id；操作记录写入 conversation_audit，actor_id 不向聊天客户端公开。

Worker 用 `FOR UPDATE SKIP LOCKED` 领取任务、120 秒租约恢复崩溃任务，生成超时 100 秒。生成前检查状态；跨实例的会话 advisory lock 避免新旧轮次同时调用模型，等待这个锁不消耗故障重试次数。生成期间不持有会话行锁，真人可以正常回复。

生成文本先保存为任务草稿。最终投递锁定会话并检查设置/轮次、任务状态，然后在同一事务插入 AI 消息并完成任务，messages 的唯一索引提供幂等保证。不符合当前状态的草稿取消，不发送。真人发送、配置和授权修改遵循相同的锁顺序。数据库故障或进程退出后，由持久化租约/草稿恢复。

Agent 共用现有身份背景和同一份有长度限制的历史，只生成回复。托管 worker 固定传入 `allowWait=false`；旧 wait 协议保留兼容性，但不参与托管调度。暂未增加 typing 延期、摘要或长期记忆，也未远程中断已经开始的模型调用；已失效调用的结果会被丢弃。

## 验证

```bash
cd apps/server
TEST_DATABASE_URL='postgres://...' go test -race ./...
# 仓库根目录
pnpm agent:test
pnpm --filter web typecheck
# 开发服务仍在运行时可隔离构建目录，避免覆盖它的 .next。
NEXT_BUILD_DIR=.next-autopilot-check pnpm --filter web build
```

Go 集成测试创建随机临时 schema，执行迁移后覆盖：三种策略、AI 运营与托管策略分离、连续三条消息刷新超时、真人在排队/生成/待投递阶段回复、模式变化、最终版本校验、多 Worker 竞争、租约/重启恢复、幂等重试、来源与审计、授权分配/撤销，以及超过 50 条消息的事件补发。模型竞争测试使用阻塞假模型，不消耗真实模型额度。
