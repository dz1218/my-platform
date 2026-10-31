# 直播间文字 AI 助手

主播在桌面底部或手机控制面板点击「呼叫 AI 助手」。助手以独立成员入房后，所有参与者（包括游客）可以发送 `@AI 问题`；回答公开显示在聊天区。输入区的 `@AI` 按钮会保留草稿并添加提问前缀。普通聊天不会触发模型。

## 运行

使用 Node 22。`pnpm dev:all` 检查 LiveKit 和模型配置后启动独立 Worker；配置缺失只跳过该 Worker。也可以单独执行 `pnpm room-agent:dev`。生产先执行 `pnpm --filter agent build`，再执行 `pnpm room-agent:start`，或部署 `apps/agent/Dockerfile.livekit`。

本地优先读取进程环境和 `apps/agent/.env`，再从 `apps/server/.env` 补充 LiveKit 配置。复用 `LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY`；不需要新的模型账号。服务端字段如下：

| 配置 | 用途 |
| --- | --- |
| `LIVEKIT_URL` / `LIVEKIT_INTERNAL_URL` | 与 Go 使用同一 LiveKit 项目；Worker 优先使用内部地址 |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | 与 Go 相同的 LiveKit 凭据 |
| `LIVEKIT_AGENT_NAME` | 与 Go 相同的派发名，默认 `room-assistant` |
| `ROOM_API_URL` | Go API origin，本地默认 `http://127.0.0.1:8080`，容器中使用 `http://api:8080` |
| `ROOM_AGENT_PORT` | Worker 健康检查端口，默认 8082 |

Docker Compose 示例连接本机 Docker LiveKit。使用云项目时替换 room-agent 的 LiveKit 地址覆盖值，并确认 Go 和 Worker 使用同一组凭据。不要将这些密钥传给浏览器或写进派发 metadata。

部署顺序：Go API → room-agent → Web。保持 LiveKit webhook 指向 Go；成员事件更新助手状态，持久化房间检查队列兜底处理呼叫超时和移除失败。回滚时先停止 Worker，再回滚界面；已有陪伴与问答 HTTP Agent 独立运行。

## 会话与故障处理

Go 负责授权、单房间派发互斥和会话状态；Worker 负责独立 `RoomAssistant` 提示词和临时问答。沿用 `live-chat.v1` `{v:1,id,text}` 数据通道，不添加数据库表。公开房间详情及 WebSocket 快照包含 `assistant`：`idle / starting / online / stopping / failed`。

每次呼叫生成新的 sessionId。只有真实 Agent 成员加入才能转为在线；Worker 在接单、入房和发送答案前检查 Go 中的当前会话。创建响应丢失时保留起始状态，防止重复派发；30 秒未入房会清理派发并进入失败重试状态。删除支持 dispatchId 或当前 sessionId，用于取消尚未拿到派发 ID 的呼叫。清理失败保持 stopping，由队列重试。

上下文只包含该助手入房后的 AI 问答，最多 20 轮、16,000 字符，移除或关房后丢弃。普通聊天、陪伴私聊、账号资料不注入。每个房间一次生成，最多排队 5 条，每名参与者最多一个未完成问题；单次调用 30 秒超时，无模型自动重试。繁忙和错误提示只发给提问者，成功答案公开发送；回复最多 500 个 UTF-16 字符，超长输出安全截断并加省略号。

不订阅或发布音视频，不申请麦克风，不占用观众连麦名额。浏览器依据 LiveKit 的 Agent 成员类型显示身份标识，不能通过昵称或消息正文伪造。

LiveKit 的成员信息与数据消息可能先后错位。浏览器识别真实 Agent 后，用 `room-assistant.ready.v1` 确认已就绪；Worker 为发送时已在房的成员暂存最多 20 条待确认消息，按原消息 ID 定向补发，由聊天区去重。晚加入的观众不会通过该机制获得此前聊天，成员离开或助手退出时清空暂存。

## 验证

运行 `pnpm agent:test`、`pnpm --filter @my-platform/client-core test`、`pnpm server:test`、`pnpm typecheck`、`pnpm check:client-boundaries`。真实房间回归使用本地 LiveKit 与测试 Go fixture，仅创建 `voice-e2e-*` 临时房间；假模型验证所有客户端公开接收、移除、重新呼叫和上下文清空。真实模型验证只发送合成问题，不使用用户私聊。

启动本地 LiveKit 后执行：

```sh
LIVEKIT_INTEGRATION=1 ROOM_ASSISTANT_INTEGRATION=1 PLAYWRIGHT_CHANNEL=chrome \
  pnpm --filter web exec playwright test tests/live-assistant.spec.ts
```

测试自动启动隔离的 Go API、假模型和 Worker，使用 18181–18184、3012 端口。默认连接 `ws://127.0.0.1:7880`，凭据与仓库的开发配置一致；其他环境通过 `LIVEKIT_TEST_URL`、`LIVEKIT_TEST_API_KEY`、`LIVEKIT_TEST_API_SECRET` 覆盖。若共享 LiveKit 的 webhook 指向开发 API，测试通过 fixture 主动同步房间状态，不修改其 webhook 配置。手机用例使用 Chrome 手机视口，不能替代真机 Safari 验收。

排障关注 Worker 是否注册成功、Go 快照的 assistant 状态、30 秒入房超时、模型错误与退出清理；不要记录模型密钥或问答正文。技术参考：[LiveKit 程序化成员与 Job 生命周期](https://docs.livekit.io/agents/server/job/)。
