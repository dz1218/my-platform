# Companion Agent

单一 `@openai/agents` Agent + Zod 4。没有 LangChain、LangGraph、SDK Session 或数据库连接。Go 提供已授权的有界上下文，Agent 仅返回候选 REPLY/SILENCE；最终发送由 Go 的批次条目事务决定。

配置 `.env.example` 中的模型端点、模型名称和密钥，与 Go 使用相同的 `AGENT_TOKEN`。默认只监听 127.0.0.1:8081。保留原有 OpenAI-compatible Chat Completions 端点配置：`LLM_STRUCTURED_OUTPUT=false` 使用 JSON mode 并通过 Zod 校验；供应商支持 JSON Schema 时可设为 true。没有自动更换供应商或读取其他应用密钥。

- `pnpm --filter agent dev`：内部服务。
- `pnpm --filter agent test`：SDK Mock、计划校验和本机 HTTP 测试，不调用真实模型。
- `pnpm --filter agent build`：编译。
- `pnpm --filter agent eval`：使用已配置模型对比 V2/V3 合成场景；默认 180 次调用，输出位于 `test-results/companion-v3`。
- `pnpm --filter agent eval:personas`：从完整角色库抽取 6 个职业各一人，每人 5 轮，共最多 30 次模型调用，输出位于 `test-results/persona-v4`。使用 `--output` 区分修改后的实验。
- `pnpm --filter agent dev:livekit`：保留既有 LiveKit 工具。

`src/prompts/companion-v4.ts` 在 V3 的自然表达规则上增加稳定角色事实、职业和个人经历、关系来源及旧资料兼容规则。Go 每次按当前会话身份读取结构化人设；完整人设不通过公开角色列表返回。`src/agents/companion.ts` 按任务选择指令，每个请求只做一次模型调用，不共享用户会话状态。聊天输入附带最近四段已发送 AI 回复的条数、Unicode 字数和问句结尾摘要；真人或来源不明的消息不参与统计，但完整保留在上下文中。摘要只用于提醒重复，不控制条数。

`src/schemas/plan.ts` 保留 0–3 条候选、总计 500 字和 20 秒延迟上限。当前指令让模型输出 `delayMs=0`，Go 根据任务快照里的 `replyPacing=typing` 计算实际延迟；旧任务缺少配置仍按候选延迟执行。`CONTEXT_UPDATE` 独立选择整理指令，不接受聊天风格摘要，只产生摘要和待用户确认的记忆候选。

JSON mode 偶尔省略建议字段 `delayMs` 时，Agent 仅补为 0，再经过原有严格校验；非法动作、空正文、重复 key、显式无效值和超预算输出仍然拒绝。模型只返回空白时记为 `incomplete_model_response`，由现有 Go 队列重试，不转换成 SILENCE，也不增加单请求模型调用次数。供应商亦说明 JSON 输出存在偶发空内容，见 [DeepSeek JSON 输出文档](https://api-docs.deepseek.com/zh-cn/guides/json_mode/)。

SDK tracing 关闭；普通日志只记录随机请求编号、策略版本、条数、字数、耗时及固定错误分类。服务端并发上限 4，生成 deadline 90 秒，供应商重试为 0，持久化重试由 Go 决定。

`POST /internal/agent/generate-plan` 返回 JSON；Go 当前复用 `/internal/reply` 的内部 SSE 整体候选事件。两者均使用 Bearer 服务鉴权，浏览器统一使用 Go WebSocket，不接收模型 token。V4 复用 V3 表达规则；历史 V2/V3 对比评测显式固定原版本，不随默认提示词升级而改名失真。

人设评测仅使用角色配置和固定合成用户台词，覆盖身份介绍、工作之外的话题、用户偏好分离、要求篡改姓名/年龄/职业和虚构共同往事。结果包含实际回复供审阅；结构校验通过不代表人设表现通过。脚本保留已完成记录，重跑同一输出目录不会重复调用已记录轮次，错误轮次也保留；需要重试时使用新输出目录。无密钥或模型不可用时不能声称真实对话已验证。

SDK 的单 Agent 与 `outputType` 接口参照 [OpenAI 官方 Agent definitions](https://developers.openai.com/api/docs/guides/agents/define-agents)。本仓库以已安装 SDK 类型和离线 SDK 测试验证集成。


## 自然回复评测

`evals/companion-v3.json` 包含 20 个单轮场景和 3 组各 10 轮对话；`evals/baseline-v2.txt` 固定保存本次改动前的提示词。默认两种策略各运行 20×3+30=90 次调用，所有输入均为合成数据。

```bash
pnpm --filter agent eval --case sarcasm-correction --samples 1 --output test-results/smoke
pnpm --filter agent eval --output test-results/companion-v3
```

支持 `--variant v2|v3|both`、`--samples 1..10`、`--concurrency 1..4`、`--case ID`。相同配置和提示词的输出目录支持断点续跑；不同实验请使用不同目录。每个模型在连续对话中接收自身已产生的回复，用户台词相同。

`results.jsonl` 和 `report.json` 保存合成文本、场景标准、模型配置及耗时；不保存密钥。`review-template.json` 留空评分，供审阅者按接话准确、回应具体、表达自然各 1–5 分评估，均分目标至少 4，关键场景逐项通过。统计气泡数量不代表质量通过，生成成功也不等于人工验收通过。修改提示词后应使用新输出目录重跑。
