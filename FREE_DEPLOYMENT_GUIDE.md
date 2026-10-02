# 小规模部署

部署步骤统一见 [部署指南](DEPLOYMENT.md)，服务边界见 [技术架构](TECH_ARCHITECTURE.md)。

小规模环境可以在同一主机运行 Go API、Go Worker、TypeScript Agent、PostgreSQL 和 Redis，并单独部署 Next.js。直播使用自建或托管 LiveKit，媒体带宽和 UDP 连通性需要独立配置。

执行 `./deploy-docker.sh` 可构建并启动 API、Worker 和 Agent；数据库、Redis、前端与 LiveKit 按部署指南配置。已有环境不要覆盖 `.env` 或数据库卷。

本文不固定云服务商的免费额度和价格；部署前应以供应商当时的资源限制、休眠策略和计费说明为准。Worker 需要常驻进程，聊天 WebSocket 需要长连接支持。只部署 HTTP API 无法处理异步模型回复。
