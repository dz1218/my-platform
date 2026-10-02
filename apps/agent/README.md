# Companion Agent

单一 `@openai/agents` Agent + Zod 4。没有 LangChain、LangGraph、SDK Session 或数据库连接。Go 提供已授权的有界上下文，Agent 仅返回候选 REPLY/SILENCE；最终发送由 Go 的批次条目事务决定。

配置 `.env.example` 中的模型端点、模型名称和密钥，与 Go 使用相同的 `AGENT_TOKEN`。默认只监听 127.0.0.1:8081。保留原有 OpenAI-compatible Chat Completions 端点配置：`LLM_STRUCTURED_OUTPUT=false` 使用 JSON mode 并通过 Zod 校验；供应商支持 JSON Schema 时可设为 true。没有自动更换供应商或读取其他应用密钥。

- `pnpm --filter agent dev`：内部服务。
- `pnpm --filter agent test`：SDK Mock、计划校验和本机 HTTP 测试，不调用真实模型。
- `pnpm --filter agent build`：编译。
- `pnpm --filter agent dev:livekit`：保留既有 LiveKit 工具。

`src/agents/companion.ts` 包含当前指令；`src/schemas/plan.ts` 定义 0–3 条候选、总计 500 字、最多 20 秒建议延迟。SDK 负责 Agent loop，最多两轮调用，输出通过应用校验；不提供发送、接管或数据库工具。`CONTEXT_UPDATE` 入口沿用同一主 Agent，为 Go 持久化异步任务产生摘要和待用户确认的记忆候选。SDK tracing 关闭，避免将聊天正文上传到 trace；日志只记录随机请求编号、耗时和固定错误分类。服务端并发上限 4，生成 deadline 90 秒，供应商重试为 0，持久化重试由 Go 决定。

`POST /internal/agent/generate-plan` 返回 JSON；Go 当前复用 `/internal/reply` 的内部 SSE 整体候选事件。两者均使用 Bearer 服务鉴权，浏览器统一使用 Go WebSocket，不接收模型 token。`src/prompts/` 保留旧版提示词供回溯，当前服务不加载它们。

SDK 的单 Agent 与 `outputType` 接口参照 [OpenAI 官方 Agent definitions](https://developers.openai.com/api/docs/guides/agents/define-agents)。本仓库以已安装 SDK 类型和离线 SDK 测试验证集成。
