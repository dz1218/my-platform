# 技术实施索引

业务后端统一在 `apps/server`：鉴权、会话、小说和直播房间由 Go/Gin 提供。模型服务继续在 `apps/agent` 使用 TypeScript。

本文作为实施文档入口，避免维护与实际代码脱节的脚手架和部署命令。

- [当前技术架构](TECH_ARCHITECTURE.md)
- [本地启动与检查](README.md)
- [API、Worker 和 Agent 部署](DEPLOYMENT.md)
- [陪伴 Agent 与服务边界](docs/companion-agent.md)
- [陪伴 V2 的实现、接口与限制](docs/companion-v2.md)
- [AI 托管及真人接管](docs/autopilot.md)

直播模块实现位于 `apps/server/internal/livekit`；自动化测试覆盖房间管理、入房令牌、Agent 调度、输入校验和上游故障。LiveKit 媒体服务与聊天模型 Agent 的运行生命周期各自独立。
