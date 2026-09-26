# Agent 与互动节奏

## 服务边界

Next.js 是普通 IM 界面和同源代理。Go 负责授权、上下文读取、消息持久化、任务调度。
TypeScript Agent 使用 LangChain.js 的 ChatDeepSeek、ChatPromptTemplate 和 LangGraph.js 的 StateGraph。
Agent 内部调用 invoke，通过 SSE 返回 `reply` 或 `error` 事件，并发送心跳。Go worker 消费 SSE；浏览器与 Go 通过 WebSocket 收发完整消息，不展示 token 流。

```text
WebSocket send → Go 验证归属 → 同一事务保存 user message + reply job → accepted
Go worker → 到 debounce 时间 → 领取带租约的任务 → TS LangGraph → SSE reply 事件
Go worker → 保存回复草稿和 due_at → 到期事务投递
Go → WebSocket history 快照 → 整条消息出现
```

浏览器不再定时轮询，通过同源 `/ws/conversations/:id` 连接 Go；Next.js 外部 rewrite 转发 WebSocket upgrade。历史初始化和翻页仍使用 HTTP。Go 每秒检查持久化历史变化，有变化才推送最新 50 条快照，并每 20 秒发送心跳。连接中断后自动退避重连并同步最新快照，发送确认丢失时沿用 requestId 手动重试。连接最长一小时，重连时重新验证登录与会话归属。

生产反向代理需允许 `/ws/` 的 WebSocket upgrade，空闲超时应大于 20 秒；`WEB_ORIGIN` 必须与浏览器来源一致。当前服务端仍查询数据库检测变化，尚未使用发布订阅。
等待对方回复期间可继续发送。没有虚假的在线、已读或“AI 正在思考”状态。
浏览器关闭不影响生成和投递。刷新历史时能看到已经投递的回复。

## 行为策略

`apps/server/config/behavior.json` 定义默认策略与 Identity 覆盖，启动 API 时读取。
配置版本和完整参数在接收消息时随任务保存，新消息使用新策略；已经排定投递时间的旧草稿保持原有 due_at。

- debounceSeconds：1 秒消息合并窗口，仅用于调度；后端不按标点或话题判断快慢。
- Agent 根据上下文和已等待时间输出动作：`reply`（正文可自然分段、追问或承接）或 `wait`（由 agent 选择 waitSeconds）。不再返回 pace 标签。
- `wait` 保存到持久化任务，到期重新构建上下文并调用 agent，不预先扣住一条生成好的回复。新消息增加版本、取消旧动作并重置等待额度。
- 执行约束：每个消息版本最多等待一次，最多 maxWaitSeconds（默认 10 秒）；额度用完时 agent 必须 reply。等待不消耗故障重试次数，进程重启后仍保留。服务端仅校验并执行动作。
- maxAttempts / retrySeconds：保留故障重试次数和递增间隔。

回复正文可以自然分段，目前仍是一条消息，不支持逐段定时气泡。没有随机阅读延迟、按字数计算的打字延迟，也不虚构忙碌或在线状态。模型判断质量仍需真实对话评估；结构化测试验证的是动作执行与约束。

## 提示词

`apps/agent/src/prompts/conversation-v2.ts` 负责表达及上下文接话方式，Go 负责动作执行与约束，`PROMPT_VERSION` 选择版本。
将来可增加记忆抽取、关系评估和主动联系模板，但它们尚未实现。
Go 提供身份事实及有限的历史快照，Agent 组织表达规则与上下文。
人物状态、用户记忆和授权仍须由业务数据库管理，不能把多个用户放在共享线程里。

## 一致性与恢复

PostgreSQL `reply_jobs` 是持久化任务真源，本轮直接使用 PostgreSQL 队列；Redis 仍用于限流。
没有同时引入 Redis Streams 双写，避免消息入库成功但任务入队丢失。

每个会话只有一个当前任务，用 version + claim_token 做过期结果校验。
新消息增加版本并清除旧草稿，重新安排 debounce。旧模型调用可能继续消耗到结束，
但返回结果不能覆盖新任务或被投递。当前未加入远程取消模型请求。

领取任务使用 SKIP LOCKED + 120 秒租约，生成超时 100 秒。进程异常退出后可重新领取。
保存的草稿不会因重启丢失。投递事务和 messages 的唯一索引避免重复回复。
自动重试耗尽后用户可重试最后一条失败消息，同一 requestId 不重复插入用户消息。

投递和接收新消息都短暂锁定 conversation 行；正在生成时不持有这个锁。
真人接管还未实现。接管上线时必须用同样锁顺序取消任务，并在每次投递时校验 Driver，
不能只在前端隐藏自动回复。

## 本地配置迁移

已有本机模型配置已迁到 `apps/agent/.env`，Go 新增 AGENT_URL、AGENT_TOKEN 和 BEHAVIOR_CONFIG。
两个服务的 AGENT_TOKEN 必须一致，不得放进 NEXT_PUBLIC 环境变量。
提示词修改后重启 Agent；策略修改后重启 API；Go 代码变化后重启 API/worker。
生产环境需同时部署 Agent 和 worker，不能只部署 Next.js 与 Go API。

## 验证

`pnpm agent:test` 使用假模型验证图执行和私有接口，不调用真实模型。
`pnpm server:test` 验证策略、内部接口协议和上下文。
设置 TEST_DATABASE_URL 后，Go 的 delivery 集成测试会创建随机独立 schema，运行迁移，
验证重复请求、用户隔离、合并补充消息、过期租约、重启投递、重试与并发不重复投递，最后删除该测试 schema。
不会清空业务表。真实 DeepSeek 调用需要有效密钥和账户权限。
