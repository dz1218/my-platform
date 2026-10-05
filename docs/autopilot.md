# 身份继承与 AI 托管

> 本文说明身份继承与双身份聊天；消息队列、记忆和逐条投递见 [Companion V2](companion-v2.md)。

## 使用

注册时选择账户性别，注册成功后进入 `/choose-identity`，可以继承一个可用的 AI 身份，也可以跳过，之后再从「我的」进入选择页。现有账号在继承前补充性别。女性账户只能继承女性 AI，男性账户只能继承男性 AI；当前种子身份均为女性，没有符合条件的身份时可以继续使用本账户。

每个 AI 身份只能被继承一次，每个账户最多继承一个身份。继承记录在数据库中唯一且不可转让；并发选择同一身份时只允许一个请求成功。继承不会创建第二个登录账户，用户可以通过界面在以下两种聊天入口之间切换：

- 本账户 `/companion`：继续与其他 AI 身份聊天，消息来源为 USER。
- 我的 AI 身份 `/operator`：查看其他用户与继承身份的会话，以该身份回复，消息来源为 HUMAN；账户 ID 只保留在服务端审计中。

继承覆盖这个 AI 身份的现有及未来会话，无需逐个分配。不能用本账户和自己继承的身份聊天；已有的此类历史仍保留，不再作为可发送的普通会话展示。其他用户可以继续与已被继承的 AI 身份聊天。身份继承和当前会话交给 AI 托管是两个状态：结束真人接管只改变回复方式，不释放继承名额。

- AI 运营：默认自动回复，接管后的托管策略暂不生效。
- 真人接管 + NEVER：不自动回复。
- 真人接管 + TIMEOUT：最后一条用户消息后等待 15 / 30 / 60 / 120 / 180 / 300 / 600 秒。
- 真人接管 + ALWAYS：按服务端 debounce 窗口合并新消息后自动回复，真人仍可插入回复。

真人回复取消当前尚未提交的 AI 任务。已经提交的 AI 消息保留在历史中。
切换设置会取消旧草稿；如果最新消息仍为用户消息，按新策略重新安排任务，超时起点仍是这条消息的保存时间。相同设置重试不增加版本。结束真人接管会恢复 AI 运营。

## 部署与授权

部署新版 API、worker、Agent 和 web，并执行 `pnpm db:migrate`（API/worker 启动时也会执行迁移）。迁移 `004_autopilot.sql` 为已有会话设置 AI 运营，不改变已有消息或账号；历史来源从既有 sender_type / driver_type 读取。滚动升级前停止旧 worker，避免旧代码绕过新的提交校验。

新增 `008_identity_inheritance.sql` 为账户和 AI 增加性别、引导完成状态及身份继承关系。现有账户不会被自动认定为某个身份的继承者。`009_retire_conversation_assignments.sql` 将尚未被继承、仍处于旧版真人接管状态的会话恢复为 AI 运营，取消旧候选，并重新安排允许自动互动的未回答轮次；保留既有消息、记忆授权和用户关闭自动互动的选择。新版前端、API 和 worker 应一起发布；本地验证只对独立测试数据库应用迁移。

旧版 `conversation_takeovers` 数据可以保留，但不再授予聊天或设置权限，也不会被自动转换成身份继承。原 `cmd/takeover` 不能用于将一个身份分配给他人、转让或撤销继承；用户通过选择页完成继承，通过聊天设置切换当前会话由真人还是 AI 回复。身份归属始终以 `identity_inheritances` 为准。

## 接口

全部在 `/api/v1` 下，使用现有登录鉴权。消息 POST 与 WebSocket send 均通过同一 delivery.Service。客户端无权指定 source、actor 或聊天身份。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | /identity-inheritance | 当前性别、引导状态、已继承身份和候选身份可用性 |
| POST | /identity-inheritance | `{ "identityId": "..." }`，确认继承；唯一性和性别由服务端校验 |
| POST | /identity-inheritance/skip | 完成引导，保留以后选择的机会 |
| POST | /identity-inheritance/gender | `{ "gender": "FEMALE" }` 或 `MALE`，仅继承前可设置 |
| GET | /operator/conversations | 继承身份与其他用户的会话 |
| GET | /conversations/:id/auto-reply | 当前设置、版本及 canManage |
| PATCH | /conversations/:id/auto-reply | `{ "mode": "TIMEOUT", "delaySeconds": 60 }` |
| POST | /conversations/:id/takeover | `{ "ownerType": "HUMAN" }` 接管，`AI` 结束接管 |
| POST | /conversations/:id/messages | `{ "content": "...", "requestId": "..." }`，来源由服务端确定 |
| GET | /conversations/:id/messages | 双方共用的历史与 source |

设置/接管权限由服务端依据身份继承关系确认，不能依据页面路径、客户端传入身份或会话 ownerType 判断。普通聊天用户不能修改对方的身份设置。继承者将某个会话交还 AI 后仍保留身份，可以再次接管；处于 AI 运营状态时不能直接以真人身份发送。

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
