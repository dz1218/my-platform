# 直播功能问题清单

审查日期：2026-10-18。状态：审查已完成，本文记录整改前的实现与问题，不代表整改已完成。

对应技术方案：[直播功能技术整改方案](./live-remediation-plan.md)。

## 审查范围与结论

范围包括房间创建与关闭、主播入场、观众加入、音视频连接、连麦权限、直播聊天、实时状态、AI 助手入口及相关测试。

当前基础架构适合小规模互动直播。保留 LiveKit 音视频传输、Go 权限校验、React Query 服务端数据缓存、Zustand 业务状态和作用域内连接管理，采用局部整改。

本次审查不代表线上部署、真实网络和容量验证已经完成。本文中的测试结果属于审查阶段，后续整改需要重新验收。

## 问题列表

| 编号 | 问题 | 实际影响 | 处理安排 |
|---|---|---|---|
| 1 | 房间生命周期与主播连接状态绑定过紧 | 刷新、意外断线可能直接关房；未完成入场时刷新可能被旧预约阻塞；返回大厅缺少确认 | 优先解决 |
| 2 | 连麦凭证两小时到期，没有续期流程 | 长时间直播后，连麦管理接口可能不可用 | **暂不解决** |
| 3 | 关闭接口与前端的失败语义不一致 | 后端已进入关闭流程，前端却提示失败重试；重复关闭可能返回错误 | 优先解决 |
| 4 | 状态同步缺少完整的异常补偿 | 启动同步失败或 webhook 丢失后，缓存状态可能长期不正确 | 优先解决 |
| 5 | 直播 AI 助手为占位实现，派发状态不完整 | 无外部真实 worker 时，呼叫后可能一直等待；缺少超时及派发去重 | **暂不解决，保留现状** |
| 6 | 直播接口和连接缺少完整的业务限流 | 恶意请求、正常重连高峰、重复刷新或前端异常可能放大后端负载 | 基础稳定性修复后处理 |
| 7 | 创建与关闭共用全局锁 | 不同房间互相等待；上游变慢时延长队列并占用数据库连接 | 单独进行并发优化 |

第 2、5 项由用户明确要求暂不处理。本轮方案不包含凭证续期、AI worker 接入、助手入口隐藏、派发超时或派发去重等改动。

## 问题说明与代码依据

### 1. 房间生命周期与主播连接状态绑定过紧

- 主播曾成功连接后，一旦服务端查不到主播，就进入关房流程。
- 新页面无法继续使用旧页面内存中的入场请求标识。
- 首次连接尚未完成时，旧预约可能保留 90 秒；前端把预约冲突当成不可重试的占用错误。
- “返回直播大厅”目前是普通导航链接，不主动确认结束。

需要一起处理入场预约、连接成功、暂时离线和主动结束，不能仅在原关房逻辑前增加一个延时。

依据：[房间生命周期与主播预约](../apps/server/internal/livekit/lifecycle.go)、[前端连接宿主](../apps/web/src/components/live/use-live-room.ts)、[返回大厅入口](../apps/web/src/components/live/live-room-client.tsx)。

### 2. 连麦凭证到期没有续期流程——暂不解决

项目自己的 `voiceToken` 在进入房间时签发，有效期为两小时，没有对应续期流程。到期后申请、批准、结束连麦等接口会拒绝请求；这不等于音视频会在两小时整自动断开。

处理决定：保留当前实现，仅记录风险，不纳入本轮整改。

依据：[凭证签发与校验](../apps/server/internal/livekit/voice.go)、[前端连麦请求](../apps/web/src/components/live/use-live-voice.ts)。

### 3. 关闭接口与前端的失败语义不一致

后端先持久化 `closing`，再调用 LiveKit 删除房间。删除失败后后台继续重试，因此 HTTP 错误并不代表房间仍能继续直播。

前端收到错误后提示重试，而再次关闭又可能被“房间已结束”的前置检查拒绝。关闭接口需要支持重复调用，并区分“请求未接受”“已接受、正在关闭”“已关闭”。

依据：[关闭任务与重试](../apps/server/internal/livekit/maintenance.go)、[管理权限与关闭接口](../apps/server/internal/livekit/handler.go)、[前端关闭动作](../packages/client-core/src/live/room/slices/operations.ts)。

### 4. 状态同步缺少完整的异常补偿

WebSocket 推送的是缓存快照，连接正常不代表缓存已与 LiveKit 核实。当前启动同步只尝试一次，后续维护主要重试已知关房任务，无法完整修复遗漏的生命周期事件。

后续加入、手动核验或重启同步可以修复部分状态，但当前没有完整的自动补偿闭环。

补充审核：未开播空房也需要自动补偿。创建后一直未连接，底层空房超时销毁而 `room_finished` webhook 丢失时，缓存仍可能长期显示“准备中”；补偿任务不能只覆盖已确认开播的房间。

依据：[启动同步与维护循环](../apps/server/internal/livekit/maintenance.go)、[缓存快照与显式核验](../apps/server/internal/livekit/snapshot.go)、[webhook 处理](../apps/server/internal/livekit/webhook.go)。

### 5. 直播 AI 助手未形成完整功能——暂不解决

仓库内 LiveKit agent 文件为占位程序，只检查 dispatch 接口，没有完整的任务接收、入房和音视频处理流程。当前普通 agent 启动入口不能等同于 LiveKit worker。

前端派发成功后设置等待状态，缺少等待超时和恢复流程；后端派发没有房间级去重。是否另外部署了外部真实 worker，本轮没有核验。

处理决定：保留当前实现与入口，仅记录问题，不纳入本轮整改。

依据：[占位 worker](../apps/agent/src/legacy-livekit.ts)、[普通 agent 入口](../apps/agent/src/main.ts)、[前端派发状态](../packages/client-core/src/live/room/slices/operations.ts)。

### 6. 直播接口和连接缺少完整的业务限流

现有权限校验不能代替限流。加入直播间会触发 LiveKit 查询、房间锁和凭证签发；连麦操作涉及参与者查询与权限更新；状态连接持续占用连接、内存和心跳资源。

这些入口没有接入与项目部分其他接口同类的业务限流。直播手动核验已有合并请求和冷却机制，但不能保护其他入口。

没有恶意脚本时风险会降低，但正常用户集中重连、反复刷新和前端异常也可能触发压力。因此限流必须允许合理突发，并配套退避重试。

直播聊天经过 LiveKit 数据通道，不经过普通聊天 HTTP 接口。现有消息长度、去重和数量上限不能提供服务端发送频率控制；接收端限频也不等于限制了上游流量。

依据：[路由与现有限流中间件](../apps/server/internal/httpapi/router.go)、[直播路由注册](../apps/server/internal/livekit/handler.go)、[直播消息发送](../apps/web/src/components/live/live-chat.tsx)、[消息校验与保留上限](../packages/client-core/src/live/chat.ts)。

### 7. 创建与关闭共用全局锁

创建与关闭在同一个全局数据库锁下执行，持锁期间调用 LiveKit。它通常不直接阻塞正在传输的音视频，但会串行化不相关房间的创建、关闭。

例如房间 A 关闭时等待 LiveKit 响应，用户 B 创建完全无关的房间也需要等待同一把锁。大量等待还可能占用数据库连接。

全局锁目前用于保证并发一致性，不能直接删除。优化时需保留一人一个房间、名称唯一性和创建结果不确定时的预约保护。

补充审核：接口允许自定义房间 ID，现有预约仅按账户保存。临时测试已复现 A 创建失败保留预约后，B 用不同名称占用同一 ID，导致 A 换 ID 创建仍被原预约阻塞。需要账户、名称及房间 ID 的持久预约；仅增加请求期间的 ID 锁不足以保护未知创建结果。

当前房间另有 50 名参与者的配置上限。该上限不在本轮自动提升。

依据：[房间创建与关闭锁](../apps/server/internal/livekit/owner_room.go)、[创建处理](../apps/server/internal/livekit/handler.go)、[LiveKit 房间容量配置](../apps/server/internal/livekit/client.go)。

## 已有验证

以下为 2026-10-18 审查阶段实际运行的结果，不是整改后的验收结果：

- Go `internal/livekit` 和 `internal/httpapi` 两个包：57 个顶层测试通过。
- client-core：34 项测试通过。
- 5 项依赖外部服务的集成测试跳过，包括真实 LiveKit、Redis/PostgreSQL 多实例验证及 matches 监听恢复测试。
- 本轮未重新运行真实浏览器音视频验收。
- 现有[浏览器媒体测试](../apps/web/tests/live-media.spec.ts)把“刷新后关房”写成预期，需要随规则修改。

审查时使用的命令：

```sh
# 在 apps/server 下执行
GOCACHE=/private/tmp/my-platform-go-cache go test -count=1 -json ./internal/livekit ./internal/httpapi

# 在仓库根目录使用 Node 22 执行
pnpm --filter @my-platform/client-core test
```

以上是现有实现的审查结果，不是整改完成记录。具体实施与验收见[技术整改方案](./live-remediation-plan.md)。
