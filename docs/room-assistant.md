# 直播间房管与文字 AI 助手

所有直播间统一使用服务端聊天和房管。主播在设备面板呼叫助手；入场后默认开启选择性回复与规则房管，合并欢迎默认关闭。

## 成员与管理

登录用户默认使用账号昵称；游客使用服务端签名的 `live_guest` HttpOnly、SameSite=Lax Cookie（30 天）获得稳定身份和「听众·编号」。房间昵称可修改，短编号保持不变，消息和成员列表均使用服务端确认的名称。登录账号与浏览器游客身份关联处罚，但不能通过游客 Cookie 继承账号或主播权限。一个账号的多个连接一起受限。

主播可以从成员列表或消息作者进入管理面板：禁言 5 分钟、30 分钟或本场直播，以及踢出本场。禁言同时阻止文字、结束连麦、阻止新申请；解除后需要重新申请并主动开麦。踢出后停止重连，刷新也会检查本场限制。管理记录显示对象、原因、证据、执行者、处理中/成功/失败，以及重试、解除限制和待确认建议。撤销绑定具体处罚 ID，不清除更新的处罚。

房间设置包含房规、置顶公告、FAQ、拦截词、慢速发言（关闭/5/10/30 秒）、自动回复、自动处罚及合并欢迎，保存为主播配置供下次开播使用。公告只能由主播发布。处罚按 LiveKit 房间 SID 隔离，不能跨场继承。

## 消息与权限

文字统一通过 Go 的 `POST /api/v1/rooms/:roomId/messages` 校验，再经现有 WebSocket 分发。浏览器和助手不通过 LiveKit 数据通道收发聊天；入场令牌及连麦授权都关闭 `canPublishData` 和自行修改成员资料。LiveKit 继续负责音视频和助手成员状态。

入场响应包含 `member` 和内存中使用的 `roomToken`。房间 HTTP 写操作通过 `X-Live-Room-Token` 验证房间 SID、连接、成员、当前账号会话和主播角色。所有写操作携带 `requestId`。Next 代理仅为房间接口转发指定 Cookie 和凭证。WebSocket 票据绑定成员，公开大厅连接不含聊天、处罚或助手建议。

| 房间接口 | 用途 |
| --- | --- |
| `GET activity` | 本人状态、成员、设置、当前连接可见聊天；主播另含管理记录 |
| `POST messages` | 发送文字，500 UTF-16 字符上限 |
| `PATCH members/me` | 修改本人房间昵称 |
| `POST moderation` | mute/kick/revoke/retry/approve/dismiss；对象使用成员 ID |
| `PATCH settings` | 主播设置 |

限制先写入 PostgreSQL，再调用 LiveKit。失败保留限制和失败状态，由现有房间检查队列重试，亦可手动重试。处罚到期在服务端解除，不授予麦克风权限。PostgreSQL 保存房间身份映射、处罚、记录、主播配置和本场公开聊天；Redis 保存聊天分发窗口、短期去重和冷却。浏览器聊天补发最多 1,000 条、30 分钟，仅补发该成员本场首次入场后的可见消息；刷新或重新进入沿用首次入场时间，新连接确认在线后恢复历史，换账号或新场次不继承。公开聊天在裁剪分发窗口前入库，助手可查询整场已保存的公开记录，不受 1,000 条或 30 分钟的分发限制。定向通知不进入公开历史。历史按房间 SID 隔离，随 30 天未更新的房管记录级联清理，后台按小时清理过期房间数据。

观众初始 LiveKit 令牌有效期 60 秒。踢出调用 `RemoveParticipant` 并携带撤销时间；Cloud 支持令牌撤销，自建版本通过加入/重连事件再检查并移除，不能保证恶意旧令牌直连的零窗口拦截。游客清除 Cookie、换浏览器或账号仍可能绕过匿名身份处罚；不使用设备指纹或 IP 封禁。

## 助手规则

- 主播明确指令、`@AI`、普通聊天依次排队。普通发言按 2 秒窗口合并，模型可保持沉默；优先房间相关问题、FAQ 和明确求助。主动回复全房间间隔至少 30 秒，同一成员至少 60 秒；显式 `@AI` 不受主动回复冷却限制。
- 助手可读取本场所有成员的公开文字，包括入场前、离线或被禁言成员的历史。最近上下文最多 100 条、16,000 字符；超出窗口的消息通过 `read_chat_history` 按成员 ID、昵称或正文关键词查询，也可分页阅读。每页最多 50 条、16,000 字符，查询上界固定在本次输入的序号。上下文不足时先查记录，不能直接声称看不到观众发言。昵称与正文视为不可信数据，不读取陪伴私聊、私人记忆、定向通知或直播音视频，不订阅或发布媒体。
- 初始事件补读入场前的近期记录；只有助手本次入场后的新消息能触发回复或管理建议，历史查询不触发旧指令。移除后重新呼叫仍能查询同场历史，换场次不继承。升级前已经过期且没有保存的消息无法恢复；仍在缓存中的公开消息随下一次聊天保存补入历史。
- 每房间一次模型生成，最多排队 5 个任务，每人一个待处理显式问题，30 秒超时，输出最多 500 字符。错误/繁忙只提示提问者。移除、关房或更换会话使迟到回复与工具调用失效。
- 基础防刷屏独立于模型：每人 10 秒最多 5 条，30 秒内第三条相同消息拦截。主播豁免慢速及刷屏规则。明确违规先提醒；启用自动处罚且助手在线时，60 秒内再次违规可禁言 5 分钟；不会自动延长，继续违规提交踢出建议。语义不确定的广告/辱骂仅建议主播判断。
- 右键点击聊天中的用户昵称或头像，只在现有草稿后插入 `@显示名 `，保留其他文字，不推断禁言等操作。主播和观众均可使用，例如 `@听众·FE7A 收到你的消息`；主播需要禁言时自行输入 `@AI 禁言`，再右键提及目标，发送 `@AI 禁言 @听众·FE7A`。右键只准备草稿，点击发送才提交；主播左键点击观众仍打开成员管理面板。
- `@AI @听众·7K2A 禁言他`、`@AI 把听众·7K2A禁言`、`@AI 禁言 听众·7K2A 5分钟`、`@AI 踢出 听众·7K2A` 由 Go 确认真实主播和唯一对象后直接执行。禁言未指定时长默认 5 分钟，也支持 30 分钟和本场直播；昵称须唯一，重名时使用带编号的显示名。主播在聊天中 @AI 发出的所有指令均视为已授权，不进行二次确认，也不创建待确认记录。禁言、踢出等已支持的操作明确时直接执行，例如 `@AI @听众·7K2A 禁言他`、`@AI @听众·7K2A 踢出他`；无法确定对象、时长或不支持的操作仅在聊天中说明未执行及原因。旧版主播指令的待确认记录取消确认入口，不补执行历史指令。模型只拥有 `suggest_moderation` 建议工具，不能直接执行、扩大时长或处理主播。
- 开启合并欢迎后，每 30 秒最多一条，合并新观众。助手不能修改公告。

Worker 使用独立凭据订阅 `GET /internal/live/rooms/:roomId/events`，通过 `GET .../history` 查询当前场次的公开历史，通过 `POST .../output` 提交回复/通知/建议；请求带 `X-Live-Room-Sid` 和 `X-Live-Assistant-Session`。Go 每次重新校验当前会话、动作、证据和冷却。事件通过服务端序号去重与补发，并携带助手入场时间以区分历史与新消息。历史查询支持 `member`、`query`、`before`、`through`、`limit`，返回正序消息和 `nextBefore` 翻页游标。

## 运行与发布

使用 Node 22。本地 `pnpm dev:all` 或 `pnpm room-agent:dev`；生产 `pnpm --filter agent build` 后 `pnpm room-agent:start`，或部署 `apps/agent/Dockerfile.livekit`。

| 配置 | 用途 |
| --- | --- |
| `LIVEKIT_URL` / `LIVEKIT_INTERNAL_URL` | Go 和 Worker 的同一 LiveKit 项目，Worker 优先内部地址 |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | LiveKit 凭据 |
| `LIVEKIT_AGENT_NAME` | 两端相同，默认 `room-assistant` |
| `ROOM_API_URL` | Go origin，本地 `http://127.0.0.1:8080`，Compose 为 `http://api:8080` |
| `ROOM_AGENT_PORT` | Worker 健康端口，默认 8082 |
| `ROOM_AGENT_TOKEN` | 两端相同，至少 32 字符；省略时由同一 `AGENT_TOKEN` 使用 HMAC 独立派生，不能作为陪伴 Agent 凭据 |
| `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` | 支持工具调用和 JSON 输出的 OpenAI 兼容模型 |
| `LLM_STRUCTURED_OUTPUT` | 默认 false，使用 JSON object 并在应用内校验；供应商明确支持 JSON Schema 时可设为 true |

本地 Worker 从 `apps/agent/.env` 读取模型配置，再从 `apps/server/.env` 补充允许的 LiveKit/服务凭据字段；不将密钥写入派发 metadata 或发送给浏览器。

发布顺序：迁移 `016_live_governance.sql`、`017_live_chat_history.sql` → Go API → room-agent Worker → Web。Go 启动器沿用现有迁移机制；多副本沿用 PostgreSQL 房间锁，业务连接池需至少 2 个连接（锁占一个，业务查询使用另一个）。保持 LiveKit webhook 指向对应 Go API。各服务需同步更新，浏览器刷新后重新获取成员凭证。未通过当前入场接口登记的连接会被移出；不保留旧消息通道、版本分流或降级路径。

人工管理和普通聊天不依赖模型健康；可分别关闭自动回复和自动处罚。排障查看处罚执行失败/重试、助手事件重连、会话拒绝与输出延迟日志，不记录消息正文或密钥。

## 验证

```sh
pnpm agent:test
pnpm --filter @my-platform/client-core test
pnpm server:test
pnpm typecheck
pnpm check:client-boundaries
LIVEKIT_INTEGRATION=1 ROOM_ASSISTANT_INTEGRATION=1 PLAYWRIGHT_CHANNEL=chrome \
  pnpm --filter web exec playwright test tests/live-governance.spec.ts tests/live-assistant.spec.ts tests/live-voice.spec.ts
```

浏览器测试使用真实 LiveKit、隔离 Go API、假模型和 Worker（18181–18184、3012 端口），仅创建 `voice-e2e-*` 房间。`LIVEKIT_TEST_URL`、`LIVEKIT_TEST_API_KEY`、`LIVEKIT_TEST_API_SECRET` 可指定独立 LiveKit。使用不连接开发 API webhook 的独立实例，避免开发 API 将测试助手当作未登记成员移除；fixture 主动同步房间状态。覆盖桌面、两位游客和手机视口；Chrome 手机视口不替代真机 Safari。

`TEST_DATABASE_URL`、`TEST_REDIS_URL` 启用 Go 的持久化集成测试；房管测试创建并删除独立 schema，验证跨实例恢复及新场次隔离，不迁移开发应用表。
