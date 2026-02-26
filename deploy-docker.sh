#!/bin/bash

# 一键部署脚本 - Docker 方案
# 适用于新买的云服务器（Ubuntu 22.04）

set -e  # 出错立即停止

echo "🚀 开始部署 My Platform (Docker 方案)..."

# ============== 1. 安装 Docker ==============
echo ""
echo "📦 步骤 1/6: 安装 Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl start docker
    systemctl enable docker
    echo "✅ Docker 安装完成"
else
    echo "✅ Docker 已安装"
fi

# 安装 Docker Compose
if ! command -v docker compose &> /dev/null; then
    echo "安装 Docker Compose Plugin..."
    apt-get update
    apt-get install -y docker-compose-plugin
fi

# ============== 2. 创建项目目录 ==============
echo ""
echo "📁 步骤 2/6: 创建项目目录..."
mkdir -p /opt/my-platform
cd /opt/my-platform

# ============== 3. 创建 Docker Compose 配置 ==============
echo ""
echo "📝 步骤 3/6: 生成配置文件..."

cat > docker-compose.yml <<'EOF'
version: '3.8'

services:
  # PostgreSQL 数据库
  postgres:
    image: postgres:15-alpine
    container_name: my-platform-db
    restart: always
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${DB_PASSWORD:-your-secure-password-change-me}
      POSTGRES_DB: my_platform
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Redis
  redis:
    image: redis:7-alpine
    container_name: my-platform-redis
    restart: always
    command: redis-server --requirepass ${REDIS_PASSWORD:-your-redis-password}
    volumes:
      - redis_data:/data
    ports:
      - "127.0.0.1:6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "--raw", "incr", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  # LiveKit Server
  livekit:
    image: livekit/livekit-server:latest
    container_name: my-platform-livekit
    restart: always
    command:
      - --config
      - /etc/livekit.yaml
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
    ports:
      - "7880:7880"      # WebSocket
      - "7881:7881/tcp"  # TCP
      - "7882:7882/udp"  # UDP (WebRTC)
    depends_on:
      - redis

  # NestJS API (使用你的代码)
  api:
    build:
      context: ./app
      dockerfile: Dockerfile.api
    container_name: my-platform-api
    restart: always
    environment:
      NODE_ENV: production
      PORT: 3020
      DATABASE_URL: postgresql://postgres:${DB_PASSWORD:-your-secure-password-change-me}@postgres:5432/my_platform
      REDIS_URL: redis://:${REDIS_PASSWORD:-your-redis-password}@redis:6379
      LIVEKIT_URL: ws://livekit:7880
      LIVEKIT_API_KEY: ${LIVEKIT_API_KEY}
      LIVEKIT_API_SECRET: ${LIVEKIT_API_SECRET}
      JWT_SECRET: ${JWT_SECRET}
      WEB_ORIGIN: https://${DOMAIN:-yourdomain.com}
    ports:
      - "127.0.0.1:3020:3020"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      livekit:
        condition: service_started

  # Nginx 反向代理
  nginx:
    image: nginx:alpine
    container_name: my-platform-nginx
    restart: always
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro  # SSL 证书（可选）
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - api

volumes:
  postgres_data:
  redis_data:

networks:
  default:
    name: my-platform-network
EOF

# ============== 4. 创建 LiveKit 配置 ==============
cat > livekit.yaml <<'EOF'
port: 7880

rtc:
  tcp_port: 7881
  udp_port: 7882
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true  # 重要：使用外部 IP

redis:
  address: redis:6379
  password: ${REDIS_PASSWORD}

keys:
  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}

logging:
  level: info
EOF

# ============== 5. 创建 Nginx 配置 ==============
cat > nginx.conf <<'EOF'
events {
    worker_connections 1024;
}

http {
    upstream api {
        server api:3020;
    }

    upstream livekit {
        server livekit:7880;
    }

    server {
        listen 80;
        server_name _;

        # API 代理
        location /api/ {
            proxy_pass http://api/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }

        # LiveKit WebSocket 代理
        location /livekit/ {
            proxy_pass http://livekit/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_read_timeout 86400;
        }

        # 健康检查
        location /health {
            return 200 "OK";
            add_header Content-Type text/plain;
        }
    }
}
EOF

# ============== 6. 创建环境变量文件 ==============
if [ ! -f .env ]; then
    echo "生成随机密码和密钥..."
    DB_PASSWORD=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
    REDIS_PASSWORD=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
    LIVEKIT_API_KEY="devkey"
    LIVEKIT_API_SECRET=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 48)
    JWT_SECRET=$(openssl rand -base64 64 | tr -dc 'a-zA-Z0-9' | head -c 64)

    cat > .env <<EOF_ENV
# 数据库密码
DB_PASSWORD=${DB_PASSWORD}

# Redis 密码
REDIS_PASSWORD=${REDIS_PASSWORD}

# LiveKit 配置
LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}

# JWT 密钥
JWT_SECRET=${JWT_SECRET}

# 域名（改成你的实际域名）
DOMAIN=yourdomain.com
EOF_ENV

    echo "✅ 已生成 .env 文件，请编辑 DOMAIN 为你的实际域名"
fi

# ============== 7. 创建 API Dockerfile ==============
mkdir -p app
cat > app/Dockerfile.api <<'EOF'
FROM node:20-alpine AS builder

WORKDIR /app

# 安装 pnpm
RUN npm install -g pnpm

# 复制项目文件（你需要先上传代码到服务器的 /opt/my-platform/app 目录）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api ./apps/api
COPY packages ./packages

# 安装依赖
RUN pnpm install --frozen-lockfile

# 构建
WORKDIR /app/apps/api
RUN pnpm prisma generate
RUN pnpm build

# 生产镜像
FROM node:20-alpine

WORKDIR /app

# 安装 pnpm
RUN npm install -g pnpm

# 复制构建产物
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./
COPY --from=builder /app/apps/api/prisma ./prisma

ENV NODE_ENV=production

EXPOSE 3020

CMD ["sh", "-c", "pnpm prisma migrate deploy && node dist/main"]
EOF

echo ""
echo "✅ 步骤 6/6: 配置文件生成完成！"
echo ""
echo "=========================================="
echo "📋 下一步操作："
echo "=========================================="
echo ""
echo "1️⃣ 编辑环境变量："
echo "   nano .env"
echo "   # 修改 DOMAIN 为你的域名（或公网IP）"
echo ""
echo "2️⃣ 上传你的代码到服务器："
echo "   # 在本地执行："
echo "   scp -r /Users/daizhuo/Desktop/my-platform/* root@你的服务器IP:/opt/my-platform/app/"
echo ""
echo "3️⃣ 启动所有服务："
echo "   docker compose up -d"
echo ""
echo "4️⃣ 查看日志："
echo "   docker compose logs -f"
echo ""
echo "5️⃣ 检查服务状态："
echo "   docker compose ps"
echo ""
echo "=========================================="
echo "🔑 重要信息已保存在 .env 文件中"
echo "=========================================="
