# 陪伴 Agent 运行与发布

陪伴使用 LangGraph 显式图、LangChain ChatOpenAI/工具/Embedding 和 PostgreSQL checkpoint。Go 继续拥有授权、消息、任务租约、业务重试、真人接管和最终投递。问答 Assistant 与直播助手保持独立，不接入陪伴的上下文或数据库。

当前默认 `COMPANION_RUNTIME=legacy`，先部署新的 Go 授权与删除保护，再影子验证、灰度切换。不要回滚 Go 到 migration 015 之前：回退 Agent 运行器也必须保留新授权和删除校验。

两条运行路径统一使用 `companion-v7` 私聊指令：角色可以自然表达普通日常，稳定身份、用户事实与共同经历保留来源约束；上下文整理保持原有严格提取规则。Go 每次注入会话时区下的日期、星期及粗粒度时段，不依赖长期记忆授权。checkpoint 与发布报告同时绑定提示词版本，旧版本的质量报告不能用于新提示词放量。

旧运行器遇到空白／结构不合法的候选只修复一次，未发送的输出不进入历史，供应商错误和取消直接交回 Go。模型调用次数写入执行元数据；影子图只使用总共三次调用中的剩余额度。`pnpm --filter agent eval:private-chat` 用合成数据覆盖日期、日常、近期上下文、长回复与未知共同经历，分别验证两条路径；它是行为回归，不替代自然度人工评分或 RAG 验收。

## 数据与权限

- `conversations.memory_consent_version=2` 才允许长期记忆。迁移保留旧记忆，但关闭旧的继承者开关并清空旧摘要。聊天用户重新明确开启；继承者不能代为授权。
- `conversation_memories` 是长期事实来源，`memory_proposals` 是待确认候选。自动保存要求用户原文、第一人称、允许的事实类别、无敏感信息/计划/假设/冲突；人工编辑优先。密码、验证码和凭据不进入记忆或索引。摘要任务每批最多 30 条消息/6000 字，按连续游标处理，合并等待 5 秒。
- `agent_documents` 是可重建索引，`agent_index_jobs` 是同事务触发的 outbox。查询先限定关系，再做精确向量和中文关键词/三元组检索，融合约 20 个候选，注入最多 6 条。读取及投递重新检查来源版本、有效期和删除状态。
- 查询和写入都用独立配置的 `text-embedding-v4`、1024 维。没有 Embedding 密钥/调用失败时，回复使用关键词检索；后台索引最多重试 8 次，失败留在队列供处理。更换模型后必须重建，不能将不同模型的向量混用。
- 编辑、删除、拒绝候选、清空、开关变更提升记忆和设置版本，取消旧任务，清空摘要与派生索引，持久化 checkpoint 清理任务。删除来源不能重新提取。旧 AI 回复可能复述被遗忘内容，因此保守地把该来源之后**已有的 AI 消息**一同排除出后续模型上下文，用户可见聊天记录保留。
- 关闭记忆停止长期记忆读写和历史 RAG；已有内容可查看、删除。清空还设置历史水位，避免旧聊天再次回填。核心角色资料始终固定注入。

## 执行约束

`RunContext` v2 由 Go 绑定关系、用户、角色、逻辑 runId、当次 claim token、版本、游标、输入哈希与 deadline。模型只看到聊天资料；检索工具只有 `query`，不能选择关系或用户。

图路径：`recall → generate → validate`；允许一次补充检索和一次结构修复，整个逻辑图最多 3 次模型调用、2 次检索。预算写入 PostgreSQL，失败调用也计数。恢复使用稳定线程、输入哈希及数据库 advisory lock；每个节点前后重新验证 Go 租约。checkpoint 不存执行凭据或原始会话输入，可能含候选回复和检索资料，保留 7 天。checkpoint 不是聊天记录。

总 deadline 最多 90 秒；HTTP、模型和检索传播取消，Go 数据库使用请求 context，checkpoint SQL 单条超时 5 秒。前台并发 4，后台（整理、Embedding、清理）并发 1；容量拒绝不消耗 Go 业务重试次数。

`REPLY/SILENCE`、最多 3 条、正文总计 500 字继续由 Agent 和 Go 双重校验。最终发送再次检查设置/轮次/记忆版本和引用来源；重复提交不重复发送。检索故障退回近期上下文，生成失败交给 Go 重试。

## 部署迁移

使用 PostgreSQL 15 + pgvector。开发与测试 Compose 已使用 `pgvector/pgvector:pg15`，主版本不变。已有 PostgreSQL 卷换镜像前做备份并验证恢复及 collation；本次未重建现有开发数据库。托管数据库先确认提供 `vector` 和 `pg_trgm` 扩展。

1. 用业务迁移账号执行 Go 增量迁移：在 `apps/server` 运行 `go run ./cmd/api -migrate-only`（容器运行 `/app/api -migrate-only`）。扩展安装在 `public`，业务表仍沿用原 schema。
2. 用运行表迁移账号设置 `AGENT_DATABASE_URL`，在 `apps/agent` 运行 `pnpm checkpoint:migrate`；容器可运行 `node dist/companion/migrate.js`。仅部署迁移执行 DDL，服务启动不会自动建表。
3. 创建独立无超级权限、无继承权限的登录角色，为其设置独立密码，只授予 `companion_runtime`。示例由 DBA 执行，替换数据库名，密码通过安全凭据渠道配置：

```sql
CREATE ROLE companion_agent LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT ON DATABASE my_platform TO companion_agent;
GRANT USAGE ON SCHEMA companion_runtime TO companion_agent;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA companion_runtime TO companion_agent;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA companion_runtime TO companion_agent;
-- 未来迁移账号创建表时，重复上述授权，或给该迁移账号设置 default privileges。
```

生产 Agent 启动检查运行账号是否能读写其他业务表，有则拒绝启动。不要让它使用 Go 的数据库账号。服务令牌和模型密钥通过已有环境注入；`AGENT_SERVER_URL` 指向 Go 内网地址，两侧 `AGENT_TOKEN` 相同。

4. 配置 `EMBEDDING_API_KEY`、`EMBEDDING_BASE_URL`、`EMBEDDING_MODEL`。保留现有聊天模型端点和密钥，无自动供应商切换。百炼业务空间专属域名也可以通过独立端点配置。
5. `COMPANION_RUNTIME=shadow` + `COMPANION_ROLLOUT_PERCENT=5` 开始稳定按关系哈希取样。影子候选不投递、不提交记忆，只记录结构对比；先生成旧候选，再给图最多 20 秒/2 次模型调用，总计不超过 3 次。该初始影子模式可能增加最多 20 秒等待，建议先用测试关系观察；不要将结构一致当作质量通过。
6. 完成下列门禁，将 `COMPANION_RELEASE_REPORT` 指向版本匹配的验收报告，再设 `COMPANION_RUNTIME=langgraph`，逐步增加比例。`NODE_ENV=production` 且 LangGraph 比例大于 0 时，报告缺失/未通过会拒绝启动。回滚只需设 `COMPANION_RUNTIME=legacy`，保留数据库结构、运行表连接与清理作业。

## 验证与质量门禁

数据库集成测试必须有 `TEST_DATABASE_URL` / `TEST_AGENT_DATABASE_URL`，不能将 skip 当通过。使用隔离测试数据库，Go 在其中建立临时 schema；不要指向生产库。

```bash
# 项目根目录；分别在环境中设置测试数据库 URL
pnpm --filter agent test
pnpm --filter @my-platform/client-core test
pnpm check:client-boundaries
# apps/server
go test ./internal/ai/... ./internal/delivery ./internal/httpapi -count=1
# apps/web
PLAYWRIGHT_CHANNEL=chrome pnpm exec playwright test --config=playwright.memory.config.ts
```

真实聊天模型评测：`pnpm --filter agent eval:companion --output test-results/companion-v6-<run>`。固定合成集覆盖已知偏好、未知共同经历、自然回应，以及姓名、地点、偏好、假设、计划、第三人、敏感信息、凭据和玩笑。会调用现有聊天模型；不发送真实用户聊天。`results.json` 保留合成响应供复核，`release-report.json` 记录版本、延迟、token 与未验收项。可用 `--case city` 定点复现；不同实验用不同目录，脚本不恢复旧结果。

该脚本的检索是固定资料，**不能产生真实向量 Recall@6**。真实模型提取后，在 `apps/server` 运行以下命令把结果实际送入 Go 保存策略：

```bash
COMPANION_EVAL_RESULTS=/absolute/path/results.json \
COMPANION_EVAL_REPORT=/absolute/path/release-report.json \
go test ./internal/delivery -run TestAgentLiveMemoryAdmission -count=1 -v
```

真实召回须在隔离关系内使用相同 Embedding 模型和中文固定问题，核对来源 ID，测量 Recall@6 后写入报告；业务隔离/删除/租约等关键测试全部成功才填写 `criticalSafetyPassed=true`。同一合成对话新旧回复交由人工盲评后填写 `humanBaseline`、`humanGraph`。这些值默认未验证，不能用模型自评分或 Mock 通过代替。

`COMPANION_LIVE_PIPELINE=1 go test ./internal/delivery -run TestAgentLivePipeline -count=1 -v` 会在临时端口启动真实 Node Agent，并用合成消息验证 LangGraph、shadow、Go 租约/检索回调与数据库最终投递。先在测试库执行 checkpoint 迁移，Agent 的现有 `.env` 需有聊天模型配置，可用 `COMPANION_EVAL_NODE` 指定 Node 22。测试不会访问现有 API 或发送用户消息。此用例默认跳过真实网络调用；发布验收必须显式执行。普通数据库测试仍必须连接测试数据库执行。

`pnpm --filter agent check:companion-release /absolute/path/release-report.json` 检查：真实 Embedding、Recall@6 ≥ 0.90、自动记忆准确率 ≥ 0.98、关键安全用例全部通过、人工分数不低于基线、模型错误为 0、模型/提示词/图/索引版本匹配。固定小样本只证明该样本，正式放量前需要扩充并保留评测集版本。费用估算可给评测进程设置 `EVAL_INPUT_PRICE_PER_MILLION` / `EVAL_OUTPUT_PRICE_PER_MILLION`（同一货币）；缺少单价保持 null，实际账单以供应商为准。

## 运维

日志不含聊天正文、检索正文、凭据或内部推理。`companion_node` 记录 runId、节点耗时及成功状态；`companion_execution` 记录图/模型/索引版本、token 与调用数；Go 投递日志通过 runId 和 batchId 关联。每分钟 `companion queue metrics` 包含前台/后台积压、失败索引、清理积压、最老任务和索引延迟。建议告警：索引失败持续大于 0、清理积压持续增长、最老任务超过租约、授权/预算错误突增。不要将合成评测原始输出接入普通生产日志。

Embedding 恢复或更换模型后，由 Go 数据库运维账号重排索引（以下操作不改业务记忆）：

```sql
UPDATE agent_documents SET embedding=NULL,embedding_hash=NULL,embedding_model=NULL;
UPDATE agent_index_jobs SET status='PENDING',attempts=0,due_at=now(),claim_token=NULL,lease_until=NULL;
```

旧任务只能写入与其 claim/content hash 匹配的索引，不能覆盖新版本；检索还要求查询模型与索引模型相同。清理失败按 15 秒重试，繁忙线程释放后再删除；旧版本从变更事务提交起即不能恢复使用。

设计依据：[LangGraph 持久化](https://docs.langchain.com/oss/javascript/langgraph/persistence)、[pgvector 范围过滤与精确搜索](https://github.com/pgvector/pgvector#filtering)、[百炼 Embedding 兼容接口](https://help.aliyun.com/zh/model-studio/embedding-interfaces-compatible-with-openai)。

## 2026-10-31 本地验收记录

- Node 22：Agent 31 项、client-core 50 项通过，无跳过；Agent build、Web typecheck 和 client-boundaries 通过。
- 独立 PostgreSQL 15 + pgvector：Go AI/context/provider、delivery、httpapi 相关套件 124 项（含子用例）通过，无数据库跳过；随后新增的私有令牌、连续前缀预算和 55 条记忆分页用例分别通过。真实模型提取的入库用例已显式执行。
- Chrome：390px 手机与 1440px 桌面记忆管理及原权限回归共 6 项通过，已检查截图。未据此声明真机 Safari 验证完成。
- 实际 Node Agent 和 Go 数据库链路：LangGraph 候选投递通过；shadow 图实际执行成功且只有旧候选进入投递。均为临时端口、合成消息。
- 当前 `deepseek-flash` 合成集 12 场景生成无错误；图执行 P50 2094ms、P95 3562ms，输入 23953 / 输出 2712 token。9 个记忆场景交给真实 Go 入库，3 条明确事实自动保存，6 个负例未自动保存；该小样本不能证明总体准确率。
- 详细本地产物在 `apps/agent/test-results/companion-v6-20261031-fixed/`，其中包含新旧回复供盲评。测试产物按仓库约定不提交。
- 发布门禁仍未通过：缺少独立 Embedding 密钥，未测真实向量 Recall@6；人工自然度评分、费用账单校准和线上容量未完成。默认保持 legacy，不自动放量。
