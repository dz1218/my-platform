# Companion Agent

陪伴支持 LangGraph + LangChain + PostgreSQL checkpoint，保留 `@openai/agents` 旧运行器作为灰度回退；独立问答与直播助手保持隔离。Go 提供已授权上下文并拥有记忆、索引、任务和最终投递。部署、权限、记忆删除语义与质量门禁见 [陪伴运行说明](../../docs/companion-runtime.md)。默认运行器仍是 `legacy`，完成迁移和验收后再切换。

配置 `.env.example` 中的模型端点、模型名称和密钥，与 Go 使用相同的 `AGENT_TOKEN`。默认只监听 127.0.0.1:8081。保留原有 OpenAI-compatible Chat Completions 端点配置：`LLM_STRUCTURED_OUTPUT=false` 使用 JSON mode 并通过 Zod 校验；供应商支持 JSON Schema 时可设为 true。没有自动更换供应商或读取其他应用密钥。

- `pnpm --filter agent dev`：内部服务。
- `pnpm --filter agent test`：SDK Mock、计划校验和本机 HTTP 测试，不调用真实模型。
- `pnpm --filter agent build`：编译。
- `pnpm --filter agent checkpoint:migrate`：部署阶段建立运行表，服务启动不做 DDL。
- `pnpm --filter agent eval:companion`：当前图的真实聊天模型合成评测；检索资料为固定 fixture，不能据此声称向量召回达标。
- `pnpm --filter agent eval:private-chat`：使用合成上下文验证日期、日常、近期消息、长回复和未知共同经历，分别经过旧运行器及 LangGraph；输出在 `test-results/private-chat`，仍需人工复核自然度。
- `pnpm --filter agent check:companion-release REPORT`：检查版本匹配的生产质量门禁。
- `pnpm --filter agent eval`：使用已配置模型对比 V2/V3 合成场景；默认 180 次调用，输出位于 `test-results/companion-v3`。
- `pnpm --filter agent eval:personas`：从完整角色库抽取 6 个职业各一人，每人 5 轮，共最多 30 次模型调用，输出位于 `test-results/persona-v4`。使用 `--output` 区分修改后的实验。
- `pnpm --filter agent dev:livekit`：独立直播文字助手，见 [接入说明](../../docs/room-assistant.md)。

`src/prompts/companion-v7.ts` 用于旧运行器和 LangGraph 的陪伴回复。保留 V5 连续私聊的节奏，允许符合人设的轻微日常表达；稳定身份、用户事实和共同经历仍需要来源，不将角色表达变成用户记忆。上下文整理继续使用原有严格来源规则。Go 注入当前关系时区下的日期、星期、时段，默认 Asia/Shanghai，与记忆授权无关；粗粒度时段避免秒级时钟令重试快照持续失效。`src/agents/companion.ts` 正常一次模型调用，空白或结构不合法时只修复一次，不将未发送候选加入前情；超时及供应商错误交回 Go。修复调用计入执行预算，影子图只使用剩余额度。聊天输入附带最近四段已发送 AI 回复的条数、Unicode 字数和问句结尾摘要；真人或来源不明的消息不参与统计，但完整保留在上下文中。摘要只用于提醒重复，不控制条数。

`src/schemas/plan.ts` 保留 0–3 条候选、总计 500 字和 20 秒延迟上限。当前指令让模型输出 `delayMs=0`，Go 根据任务快照里的 `replyPacing=typing` 计算实际延迟；旧任务缺少配置仍按候选延迟执行。`CONTEXT_UPDATE` 独立选择整理指令，不接受聊天风格摘要，只产生摘要和待用户确认的记忆候选。

V5 将角色事实核对放在聊天示例之后，避免将设想写成既有经历，或把用户的计划补成已经发生的事实。内部输出预算为 4096 token：部分供应商将思考 token 也计入输出，原 2048 预算在真实评测中出现 `finish_reason=length`，正文 JSON 被截断；提高内部预算不放宽 500 字正文校验。历史 V3/V4 评测仍固定使用 2048 token。

JSON mode 偶尔省略建议字段 `delayMs` 时，Agent 仅补为 0，再经过原有严格校验；非法动作、空正文、重复 key、显式无效值和超预算输出仍然拒绝。模型只返回空白时记为 `incomplete_model_response`，由现有 Go 队列重试，不转换成 SILENCE，也不增加单请求模型调用次数。供应商亦说明 JSON 输出存在偶发空内容，见 [DeepSeek JSON 输出文档](https://api-docs.deepseek.com/zh-cn/guides/json_mode/)。

SDK/托管 tracing 默认关闭；日志只记录执行编号、版本、token、条数、字数、耗时及固定错误分类。前台并发 4、后台 1，生成 deadline 90 秒，供应商重试为 0，持久化业务重试由 Go 决定。以下 V3–V5 提示词说明及历史评测描述的是旧运行器；V6 显式图与预算见运行说明。

`POST /internal/agent/generate-plan` 返回 JSON；Go 当前复用 `/internal/reply` 的内部 SSE 整体候选事件。两者均使用 Bearer 服务鉴权，浏览器统一使用 Go WebSocket，不接收模型 token。历史 V2/V3 对比和 V4 人设评测显式固定原版本，不随默认提示词升级而改名失真。

人设评测仅使用角色配置和固定合成用户台词，覆盖身份介绍、工作之外的话题、用户偏好分离、要求篡改姓名/年龄/职业和虚构共同往事。结果包含实际回复供审阅；结构校验通过不代表人设表现通过。脚本保留已完成记录，重跑同一输出目录不会重复调用已记录轮次，错误轮次也保留；需要重试时使用新输出目录。无密钥或模型不可用时不能声称真实对话已验证。

SDK 的单 Agent 与 `outputType` 接口参照 [OpenAI 官方 Agent definitions](https://developers.openai.com/api/docs/guides/agents/define-agents)。本仓库以已安装 SDK 类型和离线 SDK 测试验证集成。


## 自然回复评测

`evals/companion-v3.json` 包含 20 个单轮场景和 3 组各 10 轮对话；`evals/baseline-v2.txt` 固定保存本次改动前的提示词。默认两种策略各运行 20×3+30=90 次调用，所有输入均为合成数据。

```bash
pnpm --filter agent eval --case sarcasm-correction --samples 1 --output test-results/smoke
pnpm --filter agent eval --output test-results/companion-v3
```

支持 `--variant v2|v3|v4|v5|both|v4-v5`、`--suite PATH`、`--samples 1..10`、`--concurrency 1..4`、`--case ID`。`both` 仍表示 V2/V3；`samples` 只控制单轮场景。相同配置和提示词的输出目录支持断点续跑；不同实验请使用不同目录。每个模型在连续对话中接收自身已产生的回复，用户台词相同；某轮失败时停止该对话，避免用不完整前情继续评测。

`evals/companion-v5.json` 保存许可欣角色资料和“准备来上海 → 先找工作”的十轮合成对话，另含旧模板历史恢复、明确要求长短结合两个单轮场景。对比 V4/V5 共 24 次调用：

```bash
pnpm --filter agent eval --variant v4-v5 --suite evals/companion-v5.json --samples 1 --concurrency 2 --output test-results/companion-v5-live
```

检查实际内容与上下文是否贴合、长短变化是否自然、是否仍在每轮评价后建议或追问；不能只因条数增加就判定通过。

`results.jsonl` 和 `report.json` 保存合成文本、场景标准、模型配置及耗时；不保存密钥。`review-template.json` 留空评分，供审阅者按接话准确、回应具体、表达自然各 1–5 分评估，均分目标至少 4，关键场景逐项通过。统计气泡数量不代表质量通过，生成成功也不等于人工验收通过。修改提示词后应使用新输出目录重跑。
