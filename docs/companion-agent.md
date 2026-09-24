# Agent 与互动节奏

## 服务边界

Next.js 是普通 IM 界面和同源代理。Go 负责授权、上下文读取、消息持久化、任务调度。
TypeScript Agent 使用 LangChain.js 的 ChatDeepSeek、ChatPromptTemplate 和 LangGraph.js 的 StateGraph。
Agent 内部调用 invoke，返回完整 JSON；前端、Go、Agent 之间均不传 token 流。

```text
POST message → Go 验证归属 → 同一事务保存 user message + reply job → 202
Go worker → 到 debounce 时间 → 领取带租约的任务 → TS LangGraph → 完整回复
Go worker → 保存回复草稿和 due_at → 到期事务投递
Next.js → 查询最新历史 → 整条消息出现
```

当前回复通过 2.5 秒前台轮询同步，历史翻页独立缓存；切回页面自动同步。
等待对方回复期间可继续发送。没有虚假的在线、已读或“AI 正在思考”状态。
浏览器关闭不影响生成和投递。刷新历史时能看到已经投递的回复。

## 行为策略

`apps/server/config/behavior.json` 定义默认策略与 Identity 覆盖，启动 API 时读取。
配置版本和完整参数在接收消息时随任务保存，因此修改配置不改变已接收任务的节奏。

- debounceSeconds：等待用户补充消息，默认 3 秒。
- minDelaySeconds / maxDelaySeconds：从最新用户消息接收起计算的阅读延迟范围。
- charactersPerSecond / maxTypingSeconds：生成完成后按正文长度计算准备时间，至少 1 秒。
- maxAttempts / retrySeconds：模型或 Agent 故障的自动重试次数和递增间隔。

发送时间取“阅读延迟结束”和“生成完成 + 准备时间”两者较晚值。
默认角色阅读延迟为 6–35 秒范围内的不同配置；模型耗时可能使实际等待更久。
当前没有根据睡眠、工作时间制造长时间不回复，也没有自动拆成多条消息。
这些行为应通过新增可测试策略逐步加入，不能依靠提示词或前端 setTimeout。

## 提示词

`apps/agent/src/prompts/conversation-v1.ts` 只负责表达，`PROMPT_VERSION` 选择版本。
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
