# 直播平台部署方案 - 完整指南

> 提供两种方案：**完全免费方案**（¥0/月）和**云服务器混合方案**（¥68/年起）

---

## 🎯 方案选择

### 方案对比

| 项目 | 完全免费方案 | 云服务器混合方案 |
|------|-------------|-----------------|
| **成本** | ¥0/月 | ¥68-80/年（≈¥6-7/月） |
| **后端性能** | 512MB RAM, 会休眠 | 2GB RAM, 24/7 运行 |
| **数据库** | Supabase 500MB | 自建 PostgreSQL + Prisma |
| **Redis** | Upstash 远程 | 本地 Redis，延迟低 |
| **LiveKit** | LiveKit Cloud 50GB/月 | 自建，无流量限制 |
| **前端** | Vercel（免费） | Vercel（免费） |
| **冷启动** | 30-60 秒 | 无冷启动 |
| **适用场景** | 测试、低流量 | 正式运营、高流量 |

### 选择建议

**选择完全免费方案**，如果：
- ✅ 只是测试玩玩
- ✅ 估计没什么人会看
- ✅ 每月直播 < 15 场
- ✅ 可以接受 30 秒冷启动

**选择云服务器混合方案**，如果：
- ✅ 准备正式运营
- ✅ 需要 24/7 稳定在线
- ✅ 每月直播 > 15 场
- ✅ 想要更好的性能和控制权
- ✅ 预算 ¥68/年（约¥6/月）可接受

---

## 📦 方案一：云服务器混合方案（推荐）

### 成本分析

| 服务 | 提供商 | 成本 | 说明 |
|------|--------|------|------|
| **前端** | Vercel | **¥0/月** | 100GB 流量免费 |
| **云服务器** | 阿里云/腾讯云 | **¥68-80/年** | 后端+数据库+Redis+LiveKit 全部 |
| **总计** | - | **¥68/年** | 约 **¥6/月** |

### 架构图

```
用户浏览器
    ↓
[Vercel - Next.js 前端] (免费)
    ↓ API 请求
[你的云服务器 - 公网IP] (¥68/年)
    ├─ Nginx (反向代理)
    ├─ NestJS API (Docker)
    ├─ PostgreSQL + Prisma (Docker)
    ├─ Redis (Docker)
    └─ LiveKit Server (Docker)
```

### 推荐云服务器配置

#### 最低配置（¥68-80/年）

```
CPU: 2核
内存: 2GB
带宽: 3Mbps
存储: 40GB SSD
系统: Ubuntu 22.04

适用场景：10 个以内同时在线用户
推荐服务商：
  - 阿里云轻量应用服务器（香港/新加坡，无需备案）
  - 腾讯云轻量服务器
  - Vultr ($5/月)
```

### 🚀 一键部署脚本

#### 1. 购买云服务器

**推荐阿里云香港节点**（不需要备案）：

1. 访问：https://www.aliyun.com/product/swas
2. 选择配置：
   ```
   地域：中国香港 或 新加坡
   镜像：Ubuntu 22.04
   套餐：2核2GB 3Mbps
   ```
3. 购买后获得：
   - 公网 IP：`123.45.67.89`
   - SSH 密码（或上传 SSH 密钥）

#### 2. 连接到服务器

```bash
# 本地终端执行
ssh root@你的服务器IP
```

#### 3. 运行一键部署脚本

在服务器上执行：

```bash
# 下载部署脚本
curl -O https://raw.githubusercontent.com/你的仓库/main/deploy-docker.sh

# 或者手动创建（如果没有 GitHub）
nano deploy-docker.sh
# 粘贴脚本内容（见下方完整脚本）

# 添加执行权限
chmod +x deploy-docker.sh

# 运行部署
./deploy-docker.sh
```

#### 4. 完整部署脚本内容

```bash
#!/bin/bash
# 一键部署脚本 - Docker 方案
# 适用于新买的云服务器（Ubuntu 22.04）

set -e  # 出错立即停止

echo "🚀 开始部署 My Platform (Docker 方案)..."

# ============== 1. 安装 Docker ==============
echo ""
echo "📦 步骤 1/7: 安装 Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl start docker
    systemctl enable docker
    echo "✅ Docker 安装完成"
else
    echo "✅ Docker 已安装"
fi

# 安装 Docker Compose Plugin
if ! docker compose version &> /dev/null 2>&1; then
    echo "安装 Docker Compose Plugin..."
    apt-get update
    apt-get install -y docker-compose-plugin
fi

# ============== 2. 创建项目目录 ==============
echo ""
echo "📁 步骤 2/7: 创建项目目录..."
mkdir -p /opt/my-platform
cd /opt/my-platform

# ============== 3. 生成随机密码 ==============
echo ""
echo "🔐 步骤 3/7: 生成安全密钥..."
DB_PASSWORD=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
REDIS_PASSWORD=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
LIVEKIT_API_KEY="devkey"
LIVEKIT_API_SECRET=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 48)
JWT_SECRET=$(openssl rand -base64 64 | tr -dc 'a-zA-Z0-9' | head -c 64)

# 获取服务器公网 IP
PUBLIC_IP=$(curl -s ifconfig.me)

cat > .env <<EOF
# 数据库密码
DB_PASSWORD=${DB_PASSWORD}

# Redis 密码
REDIS_PASSWORD=${REDIS_PASSWORD}

# LiveKit 配置
LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}

# JWT 密钥
JWT_SECRET=${JWT_SECRET}

# 服务器公网 IP
PUBLIC_IP=${PUBLIC_IP}
EOF

echo "✅ 安全密钥已生成并保存到 .env"

# ============== 4. 创建 Docker Compose 配置 ==============
echo ""
echo "📝 步骤 4/7: 创建 Docker Compose 配置..."

cat > docker-compose.yml <<'COMPOSE_EOF'
version: '3.8'

services:
  # PostgreSQL 数据库
  postgres:
    image: postgres:15-alpine
    container_name: my-platform-db
    restart: always
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${DB_PASSWORD}
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
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    ports:
      - "127.0.0.1:6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "--raw", "incr", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  # LiveKit Server
  livekit:
    image: livekit/livekit-server:latest
    container_name: my-platform-livekit
    restart: always
    command: --config /etc/livekit.yaml
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
    ports:
      - "7880:7880"      # WebSocket
      - "7881:7881/tcp"  # TCP
      - "7882:7882/udp"  # UDP (WebRTC)
    environment:
      - LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
      - LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
      - REDIS_PASSWORD=${REDIS_PASSWORD}
    depends_on:
      redis:
        condition: service_healthy

  # Nginx 反向代理
  nginx:
    image: nginx:alpine
    container_name: my-platform-nginx
    restart: always
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    ports:
      - "80:80"
    depends_on:
      - livekit

volumes:
  postgres_data:
  redis_data:
COMPOSE_EOF

# ============== 5. 创建 LiveKit 配置 ==============
echo ""
echo "📝 步骤 5/7: 创建 LiveKit 配置..."

cat > livekit.yaml <<LIVEKIT_EOF
port: 7880

rtc:
  tcp_port: 7881
  udp_port: 7882
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true

redis:
  address: redis:6379
  password: \${REDIS_PASSWORD}

keys:
  \${LIVEKIT_API_KEY}: \${LIVEKIT_API_SECRET}

logging:
  level: info
LIVEKIT_EOF

# ============== 6. 创建 Nginx 配置 ==============
echo ""
echo "📝 步骤 6/7: 创建 Nginx 配置..."

cat > nginx.conf <<'NGINX_EOF'
events {
    worker_connections 1024;
}

http {
    # LiveKit WebSocket 代理
    upstream livekit {
        server livekit:7880;
    }

    server {
        listen 80;
        server_name _;

        # 允许大文件上传
        client_max_body_size 100M;

        # LiveKit WebSocket 代理
        location / {
            proxy_pass http://livekit;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 86400;
        }

        # 健康检查
        location /health {
            return 200 "OK\n";
            add_header Content-Type text/plain;
        }
    }
}
NGINX_EOF

# ============== 7. 启动服务 ==============
echo ""
echo "🚀 步骤 7/7: 启动所有服务..."

# 加载环境变量
export $(cat .env | xargs)

# 启动服务
docker compose up -d

echo ""
echo "⏳ 等待服务启动..."
sleep 10

# 检查服务状态
docker compose ps

echo ""
echo "=========================================="
echo "🎉 部署完成！"
echo "=========================================="
echo ""
echo "📋 服务信息："
echo ""
echo "  LiveKit WebSocket URL:"
echo "    ws://${PUBLIC_IP}"
echo ""
echo "  LiveKit API Key:"
echo "    ${LIVEKIT_API_KEY}"
echo ""
echo "  LiveKit API Secret:"
echo "    ${LIVEKIT_API_SECRET}"
echo ""
echo "  数据库连接串："
echo "    postgresql://postgres:${DB_PASSWORD}@${PUBLIC_IP}:5432/my_platform"
echo ""
echo "  Redis 连接串："
echo "    redis://:${REDIS_PASSWORD}@${PUBLIC_IP}:6379"
echo ""
echo "=========================================="
echo "📝 重要提示："
echo "=========================================="
echo ""
echo "1. 所有密钥已保存在 /opt/my-platform/.env"
echo "2. 请妥善保管这些密钥！"
echo "3. 接下来需要："
echo "   - 在 Vercel 部署前端"
echo "   - 配置前端环境变量（使用上面的信息）"
echo ""
echo "=========================================="
echo "🔧 常用命令："
echo "=========================================="
echo ""
echo "查看日志：    docker compose logs -f"
echo "重启服务：    docker compose restart"
echo "停止服务：    docker compose down"
echo "查看状态：    docker compose ps"
echo ""
```

#### 5. 配置防火墙

部署完成后，需要开放端口：

```bash
# 方法 1：使用 ufw（Ubuntu）
ufw allow 80/tcp      # HTTP
ufw allow 7880/tcp    # LiveKit WebSocket
ufw allow 7881/tcp    # LiveKit TCP
ufw allow 7882/udp    # LiveKit UDP
ufw enable

# 方法 2：在云服务商控制台配置安全组
# 阿里云/腾讯云：进入控制台 → 安全组 → 添加规则
```

**需要开放的端口**：
- `80` - HTTP（Nginx）
- `7880` - LiveKit WebSocket
- `7881` - LiveKit TCP
- `7882` - LiveKit UDP（重要！）

#### 6. 部署前端到 Vercel

在**本地**执行：

```bash
# 1. 更新前端环境变量
# 创建 apps/web/.env.production
cat > apps/web/.env.production <<EOF
NEXT_PUBLIC_API_BASE_URL=http://你的服务器IP
NEXT_PUBLIC_LIVEKIT_URL=ws://你的服务器IP
EOF

# 2. 推送到 GitHub
git add .
git commit -m "Update production config"
git push origin main

# 3. 在 Vercel 导入项目（参考完全免费方案的步骤）
```

**Vercel 环境变量配置**：
```bash
NEXT_PUBLIC_LIVEKIT_URL=ws://你的服务器IP
```

#### 7. 测试完整流程

```bash
# 1. 测试 LiveKit
curl http://你的服务器IP/health
# 应该返回: OK

# 2. 访问 Vercel 前端
# 打开 https://your-app.vercel.app

# 3. 创建房间并测试直播
```

### 维护管理

#### 查看服务状态

```bash
cd /opt/my-platform
docker compose ps
```

#### 查看日志

```bash
# 查看所有日志
docker compose logs -f

# 查看特定服务
docker compose logs -f livekit
docker compose logs -f postgres
```

#### 重启服务

```bash
# 重启所有服务
docker compose restart

# 重启特定服务
docker compose restart livekit
```

#### 更新 API 代码

```bash
# 1. 在本地修改代码
git add .
git commit -m "Update API"
git push origin main

# 2. 在服务器上拉取更新
cd /opt/my-platform/app
git pull

# 3. 重新构建并重启
docker compose up -d --build api
```

#### 备份数据库

```bash
# 备份
docker exec my-platform-db pg_dump -U postgres my_platform > backup.sql

# 恢复
docker exec -i my-platform-db psql -U postgres my_platform < backup.sql
```

### 成本优化

#### 使用 CDN 加速（可选）

如果访问量大，可以配置 Cloudflare CDN：

1. 注册 Cloudflare（免费）
2. 添加域名
3. 配置 DNS 指向你的服务器 IP
4. 启用 CDN 加速

**效果**：
- 全球访问速度提升 50%+
- 节省服务器带宽
- 免费 DDoS 防护

---

## 📦 方案 1B：云服务器 API + 免费服务（强烈推荐）

> **最佳性价比方案**：只在云服务器部署后端 API，其他全用免费服务

### 成本分析

| 服务 | 提供商 | 成本 | 说明 |
|------|--------|------|------|
| **后端 API** | 云服务器 | **¥68/年** | 24/7 运行，不休眠 |
| **前端** | Vercel | ¥0 | 100GB 流量/月 |
| **数据库** | Supabase | ¥0 | 500MB + Prisma |
| **Redis** | Upstash | ¥0 | 10,000 命令/天 |
| **LiveKit** | LiveKit Cloud | ¥0 | 50GB 流量/月 |
| **总计** | - | **¥68/年** | 约 **¥6/月** |

### 架构图

```
用户浏览器
    ↓
[Vercel - Next.js 前端] (免费)
    ↓ API 请求
[云服务器 - NestJS API] (¥68/年)
    ↓
[免费服务]
├─ Supabase (PostgreSQL + Prisma)
├─ Upstash (Redis)
└─ LiveKit Cloud (50GB/月)
```

### 为什么选这个方案？

✅ **后端不休眠**（24/7 运行）
✅ **成本极低**（只需 ¥68/年）
✅ **其他服务零维护**（全部托管）
✅ **数据库有 Web UI**（Supabase 可视化管理）
✅ **LiveKit 零维护**（Cloud 版自动扩展）
✅ **可随时升级**（流量大了再迁移数据库）

---

### 🚀 完整部署步骤（30 分钟）

#### 步骤 1：购买云服务器（5 分钟）

1. 访问：https://www.aliyun.com/product/swas
2. 选择配置：
   ```
   地域：中国香港（无需备案）
   镜像：Ubuntu 22.04
   套餐：2核2GB 3Mbps
   价格：¥68/年
   ```
3. 购买后获得公网 IP

---

#### 步骤 2：注册免费服务（10 分钟）

##### 2.1 Supabase（数据库）

1. 访问：https://supabase.com
2. GitHub 登录 → 创建项目
3. 配置：
   ```
   Project Name: my-platform-db
   Database Password: [设置强密码]
   Region: Singapore
   ```
4. 获取连接串：Settings → Database → Connection string (URI)
   ```
   postgresql://postgres:[PASSWORD]@db.xxx.supabase.co:5432/postgres
   ```

##### 2.2 Upstash（Redis）

1. 访问：https://upstash.com
2. GitHub 登录 → 创建数据库
3. 配置：
   ```
   Name: my-platform-redis
   Region: ap-southeast-1 (Singapore)
   ```
4. 获取连接串：
   ```
   https://xxx.upstash.io
   ```

##### 2.3 LiveKit Cloud

1. 访问：https://cloud.livekit.io
2. GitHub 登录 → 创建项目
3. 配置：
   ```
   Project Name: my-platform
   Region: Singapore
   ```
4. 获取凭证：
   ```
   LiveKit URL:     wss://your-project-xxx.livekit.cloud
   API Key:         APIxxxxxxxxxxxx
   API Secret:      xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

---

#### 步骤 3：部署 NestJS API 到云服务器（10 分钟）

##### 3.1 连接到服务器

```bash
ssh root@你的服务器IP
```

##### 3.2 运行一键部署脚本

在服务器上创建并运行脚本：

```bash
# 创建部署脚本
cat > /root/deploy-api.sh <<'SCRIPT_EOF'
#!/bin/bash
# NestJS API 一键部署脚本

set -e

echo "🚀 开始部署 NestJS API..."

# 1. 更新系统
echo "📦 更新系统..."
apt-get update

# 2. 安装 Node.js 20
echo "📦 安装 Node.js 20..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# 3. 安装 pnpm
echo "📦 安装 pnpm..."
npm install -g pnpm

# 4. 安装 PM2
echo "📦 安装 PM2..."
npm install -g pm2

# 5. 安装 Git（如果没有）
if ! command -v git &> /dev/null; then
    apt-get install -y git
fi

echo ""
echo "✅ 依赖安装完成！"
echo ""
echo "=========================================="
echo "📋 下一步："
echo "=========================================="
echo ""
echo "1. 上传代码到服务器："
echo "   方法 A: scp -r /path/to/my-platform root@IP:/opt/my-platform"
echo "   方法 B: git clone https://github.com/你的仓库.git /opt/my-platform"
echo ""
echo "2. 配置环境变量："
echo "   cd /opt/my-platform/apps/api"
echo "   nano .env"
echo ""
echo "3. 运行部署命令："
echo "   /root/deploy-api.sh build"
echo ""

# 检查是否传入 build 参数
if [ "$1" == "build" ]; then
    echo "=========================================="
    echo "🔨 开始构建和部署..."
    echo "=========================================="

    if [ ! -d "/opt/my-platform" ]; then
        echo "❌ 错误：找不到 /opt/my-platform 目录"
        echo "请先上传代码到服务器"
        exit 1
    fi

    cd /opt/my-platform

    # 安装依赖
    echo "📦 安装依赖..."
    pnpm install

    # 切换到 API 目录
    cd apps/api

    # 检查 .env 文件
    if [ ! -f ".env" ]; then
        echo "⚠️  警告：.env 文件不存在，创建模板..."
        cat > .env <<EOF
NODE_ENV=production
PORT=3000

# 数据库（Supabase）
DATABASE_URL=postgresql://postgres:PASSWORD@db.xxx.supabase.co:5432/postgres

# Redis（Upstash）
REDIS_URL=https://xxx.upstash.io

# LiveKit Cloud
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# JWT 密钥
JWT_SECRET=$(openssl rand -base64 32)

# CORS
WEB_ORIGIN=https://your-app.vercel.app
EOF
        echo "❌ 请先编辑 /opt/my-platform/apps/api/.env 文件"
        echo "   nano /opt/my-platform/apps/api/.env"
        exit 1
    fi

    # 生成 Prisma Client
    echo "🔧 生成 Prisma Client..."
    pnpm prisma generate

    # 构建 API
    echo "🔨 构建 API..."
    pnpm build

    # 运行数据库迁移
    echo "🗄️ 运行数据库迁移..."
    pnpm prisma migrate deploy

    # 停止旧进程（如果存在）
    pm2 delete api 2>/dev/null || true

    # 启动 API
    echo "🚀 启动 API..."
    pm2 start dist/main.js --name api

    # 保存 PM2 配置
    pm2 save

    # 设置开机自启
    pm2 startup | tail -n 1 | bash

    # 获取服务器 IP
    PUBLIC_IP=$(curl -s ifconfig.me)

    echo ""
    echo "=========================================="
    echo "🎉 部署完成！"
    echo "=========================================="
    echo ""
    echo "📋 服务信息："
    echo ""
    echo "  API URL: http://${PUBLIC_IP}:3000"
    echo ""
    echo "🔧 常用命令："
    echo "  查看日志: pm2 logs api"
    echo "  重启服务: pm2 restart api"
    echo "  查看状态: pm2 status"
    echo "  停止服务: pm2 stop api"
    echo ""
    echo "🔒 安全提示："
    echo "  请开放端口 3000（或在 Nginx 后面配置反向代理）"
    echo "  ufw allow 3000/tcp"
    echo ""
fi
SCRIPT_EOF

# 添加执行权限
chmod +x /root/deploy-api.sh

# 运行脚本
/root/deploy-api.sh
```

##### 3.3 上传代码到服务器

**方法 A：使用 SCP（本地执行）**

```bash
# 在本地终端执行
cd /Users/daizhuo/Desktop/my-platform
scp -r ./* root@你的服务器IP:/opt/my-platform/
```

**方法 B：使用 Git（服务器执行）**

```bash
# 在服务器上执行
cd /opt
git clone https://github.com/你的用户名/你的仓库.git my-platform
```

##### 3.4 配置环境变量

```bash
# 在服务器上执行
cd /opt/my-platform/apps/api
nano .env
```

填入以下内容（使用你在步骤 2 获取的真实值）：

```bash
NODE_ENV=production
PORT=3000

# 数据库（Supabase）
DATABASE_URL=postgresql://postgres:[你的密码]@db.xxx.supabase.co:5432/postgres

# Redis（Upstash）
REDIS_URL=https://xxx.upstash.io

# LiveKit Cloud
LIVEKIT_URL=wss://your-project-xxx.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# JWT 密钥（生成一个随机字符串）
JWT_SECRET=your-random-secret-at-least-32-chars

# CORS（稍后改为 Vercel 域名）
WEB_ORIGIN=https://your-app.vercel.app
```

**生成 JWT_SECRET**：
```bash
openssl rand -base64 32
```

保存文件：`Ctrl+X` → `Y` → `Enter`

##### 3.5 构建和启动 API

```bash
# 运行部署脚本
/root/deploy-api.sh build
```

##### 3.6 开放端口

```bash
# 方法 1：使用 ufw
ufw allow 3000/tcp
ufw enable

# 方法 2：在阿里云控制台配置安全组
# 进入控制台 → 安全组 → 添加规则：TCP 3000
```

##### 3.7 测试 API

```bash
# 在本地执行
curl http://你的服务器IP:3000/health

# 应该返回类似：
# {"ok":true,"service":"api"}
```

---

#### 步骤 4：部署前端到 Vercel（5 分钟）

##### 4.1 准备环境变量

在本地创建 `apps/web/.env.production`：

```bash
# 在本地执行
cd /Users/daizhuo/Desktop/my-platform
cat > apps/web/.env.production <<EOF
NEXT_PUBLIC_API_BASE_URL=http://你的服务器IP:3000
NEXT_PUBLIC_LIVEKIT_URL=wss://your-project-xxx.livekit.cloud
EOF
```

##### 4.2 推送到 GitHub

```bash
git add .
git commit -m "Add production config"
git push origin main
```

##### 4.3 部署到 Vercel

1. 访问：https://vercel.com
2. GitHub 登录 → **Add New Project**
3. 选择你的仓库
4. 配置：
   ```
   Framework: Next.js
   Root Directory: apps/web
   Build Command: cd ../.. && pnpm install && pnpm build --filter=web
   Output Directory: apps/web/.next
   Install Command: pnpm install
   ```

5. 添加环境变量：
   ```bash
   NEXT_PUBLIC_API_BASE_URL=http://你的服务器IP:3000
   NEXT_PUBLIC_LIVEKIT_URL=wss://your-project-xxx.livekit.cloud
   ```

6. 点击 **Deploy**，等待 3-5 分钟

7. 部署成功后，获得 URL：`https://your-app.vercel.app`

##### 4.4 更新后端 CORS

回到服务器，更新 API 的 `.env`：

```bash
nano /opt/my-platform/apps/api/.env
```

修改：
```bash
WEB_ORIGIN=https://your-app.vercel.app
```

重启 API：
```bash
pm2 restart api
```

---

#### 步骤 5：测试完整流程

1. 打开：`https://your-app.vercel.app`
2. 创建房间
3. 加入房间
4. 开启摄像头/麦克风
5. 打开隐私窗口，加入同一个房间
6. 测试多人视频通话

---

### 🔧 维护管理

#### 查看 API 状态

```bash
pm2 status
```

#### 查看日志

```bash
# 实时日志
pm2 logs api

# 最近 100 行
pm2 logs api --lines 100

# 只看错误日志
pm2 logs api --err
```

#### 重启 API

```bash
pm2 restart api
```

#### 更新代码

```bash
# 方法 1：Git 拉取（如果用 Git）
cd /opt/my-platform
git pull
/root/deploy-api.sh build

# 方法 2：SCP 上传（本地执行）
cd /Users/daizhuo/Desktop/my-platform
scp -r apps/api/* root@你的服务器IP:/opt/my-platform/apps/api/
# 然后在服务器上重新构建
ssh root@你的服务器IP
/root/deploy-api.sh build
```

#### 查看数据库（Supabase）

1. 访问：https://app.supabase.com
2. 选择你的项目
3. 点击 **Table Editor** 查看数据
4. 点击 **SQL Editor** 运行 SQL

#### 监控 LiveKit 流量

1. 访问：https://cloud.livekit.io
2. 选择你的项目
3. 查看 **Usage** 页面
4. 查看当月流量使用情况

---

### 📊 成本预估

| 流量规模 | LiveKit 成本 | 总成本 |
|---------|-------------|--------|
| < 50GB/月 | ¥0（免费额度） | **¥68/年** |
| 100GB/月 | ¥0 + $7.5 ≈ ¥54/月 | ¥68/年 + ¥54/月 |
| 200GB/月 | ¥0 + $22.5 ≈ ¥162/月 | ¥68/年 + ¥162/月 |

**如果流量超出免费额度怎么办？**

两个选择：
1. **继续用 LiveKit Cloud**（按量付费 $0.15/GB）
2. **迁移到自建 LiveKit**（参考方案一，无流量限制）

---

### 🎯 方案总结

✅ **成本**: ¥68/年（约 ¥6/月）
✅ **后端**: 24/7 运行，不休眠
✅ **数据库**: Supabase 托管，有 Web UI
✅ **Redis**: Upstash 托管，零维护
✅ **LiveKit**: Cloud 托管，50GB/月免费
✅ **前端**: Vercel 托管，全球 CDN

**适合人群**：
- 想要稳定后端（不休眠）
- 不想自己管理数据库和 Redis
- 预算 ¥68/年可接受
- 月流量 < 50GB（约 15 场直播）

---

## 📦 方案二：完全免费部署方案

### 📋 免费服务清单

| 服务 | 提供商 | 免费额度 | 适用场景 |
|------|--------|---------|---------|
| **前端托管** | Vercel | 100GB 流量/月 | Next.js 应用 |
| **后端托管** | Render / Railway | 512MB RAM, 自动休眠 | NestJS API |
| **数据库** | Supabase | 500MB + 2GB 带宽/月 | PostgreSQL |
| **Redis** | Upstash | 10,000 命令/天 | 缓存 |
| **LiveKit** | LiveKit Cloud | 50GB 流量/月 | 实时通信 |
| **文件存储** | Cloudflare R2 | 10GB 存储 | 图片/视频 |

**总免费额度价值**：约 **$50/月**（≈¥360/月）

---

## 🚀 部署步骤（30 分钟完成）

### 准备工作

1. ✅ GitHub 账号
2. ✅ 项目代码已推送到 GitHub
3. ✅ 一个邮箱（用于注册各个服务）

---

## 第一步：部署数据库（Supabase）

### 1. 注册 Supabase

访问：https://supabase.com

- 点击 **"Start your project"**
- 使用 GitHub 登录
- 创建一个新组织（Organization）

### 2. 创建项目

```
Project Name: live-platform
Database Password: 设置一个强密码（记住它）
Region: Northeast Asia (Tokyo) 或 Southeast Asia (Singapore)
Pricing Plan: Free
```

点击 **"Create new project"**，等待 2 分钟初始化。

### 3. 获取数据库连接串

初始化完成后：

1. 点击左侧 **Settings** → **Database**
2. 找到 **Connection string**
3. 选择 **URI** 模式
4. 复制连接串，类似：
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxx.supabase.co:5432/postgres
   ```

### 4. 运行数据库迁移

在本地项目中：

```bash
# 1. 更新 .env
DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.xxx.supabase.co:5432/postgres"

# 2. 运行迁移
cd packages/db
pnpm prisma migrate deploy

# 或者直接推送 schema
pnpm prisma db push
```

---

## 第二步：部署 Redis（Upstash）

### 1. 注册 Upstash

访问：https://upstash.com

- 使用 GitHub 或 Google 登录
- 选择 **Free Plan**

### 2. 创建 Redis 数据库

1. 点击 **"Create Database"**
2. 配置：
   ```
   Name: live-platform-redis
   Type: Regional
   Region: ap-southeast-1 (Singapore) 或 ap-northeast-1 (Tokyo)
   ```
3. 点击 **"Create"**

### 3. 获取连接串

1. 进入数据库详情页
2. 找到 **REST API** 部分
3. 复制 **UPSTASH_REDIS_REST_URL**：
   ```
   https://xxx.upstash.io
   ```

---

## 第三步：申请 LiveKit Cloud

### 1. 注册 LiveKit Cloud

访问：https://cloud.livekit.io

- 使用 GitHub 或 Google 登录
- 填写基本信息

### 2. 创建项目

1. 点击 **"Create Project"**
2. 项目名称：`live-platform`
3. 选择区域：**Singapore** 或 **Tokyo**

### 3. 获取凭证

创建完成后，复制以下信息：

```
LiveKit URL:     wss://your-project-xxx.livekit.cloud
API Key:         APIxxxxxxxxxxxx
API Secret:      xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**重要**：妥善保存这些凭证！

---

## 第四步：部署后端 API（Render）

### 1. 注册 Render

访问：https://render.com

- 使用 GitHub 登录
- 授权访问你的仓库

### 2. 创建 Web Service

1. 点击 **"New +"** → **"Web Service"**
2. 选择你的 GitHub 仓库
3. 配置：

```
Name: live-platform-api
Region: Singapore
Branch: main
Root Directory: apps/api
Runtime: Node
Build Command: pnpm install && pnpm build --filter=api
Start Command: node dist/main.js
Instance Type: Free
```

### 3. 配置环境变量

在 **Environment** 部分添加：

```bash
NODE_ENV=production
PORT=10000

# 数据库（从 Supabase 复制）
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.xxx.supabase.co:5432/postgres

# Redis（从 Upstash 复制）
REDIS_URL=https://xxx.upstash.io

# LiveKit（从 LiveKit Cloud 复制）
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# JWT（自己生成一个随机字符串）
JWT_SECRET=your-super-secret-key-min-32-chars

# CORS（稍后会改为你的前端域名）
WEB_ORIGIN=https://your-app.vercel.app
```

**生成 JWT_SECRET**：
```bash
openssl rand -base64 32
# 或
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 4. 部署

点击 **"Create Web Service"**，等待部署（约 5-10 分钟）。

部署成功后，你会得到一个 URL：
```
https://live-platform-api.onrender.com
```

**测试 API**：
```bash
curl https://live-platform-api.onrender.com/health
# 应该返回: {"ok":true,"service":"api"}
```

---

## 第五步：部署前端（Vercel）

### 1. 注册 Vercel

访问：https://vercel.com

- 使用 GitHub 登录
- 授权访问你的仓库

### 2. 导入项目

1. 点击 **"Add New..."** → **"Project"**
2. 选择你的 GitHub 仓库
3. 配置：

```
Framework Preset: Next.js
Root Directory: apps/web
Build Command: cd ../.. && pnpm install && pnpm build --filter=web
Output Directory: apps/web/.next
Install Command: pnpm install
```

### 3. 配置环境变量

在 **Environment Variables** 部分添加：

```bash
# API 地址（从 Render 复制）
NEXT_PUBLIC_API_BASE_URL=https://live-platform-api.onrender.com

# LiveKit（从 LiveKit Cloud 复制）
NEXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud

# NextAuth（自己生成）
NEXTAUTH_SECRET=another-random-secret-min-32-chars
NEXTAUTH_URL=https://your-app.vercel.app
```

### 4. 部署

点击 **"Deploy"**，等待部署（约 3-5 分钟）。

部署成功后，你会得到一个 URL：
```
https://your-app.vercel.app
```

### 5. 更新后端 CORS

回到 Render，更新环境变量：
```bash
WEB_ORIGIN=https://your-app.vercel.app
```

点击 **"Manual Deploy"** 重新部署。

---

## 第六步：测试完整流程

### 1. 访问前端

打开：`https://your-app.vercel.app`

### 2. 创建房间

1. 进入 `/live` 页面
2. 输入房间标题
3. 点击"创建房间"

### 3. 加入房间

1. 点击创建好的房间
2. 输入 Identity
3. 点击"加入房间"
4. 点击"开启麦克风/摄像头"

### 4. 测试多人

1. 打开隐私窗口
2. 访问同一个房间
3. 加入后应该能看到对方的视频

---

## ⚠️ 免费方案的限制

### 1. Render 免费版会**自动休眠**

**问题**：15 分钟无请求后，服务器会休眠，下次访问需要 30-60 秒冷启动。

**解决方案**：

#### 方法 A：使用定时 Ping（推荐）

创建一个免费的 Cron 服务来定期访问你的 API：

**使用 cron-job.org**（免费）：

1. 访问：https://cron-job.org
2. 注册账号
3. 创建 Cron Job：
   ```
   URL: https://live-platform-api.onrender.com/health
   Schedule: */10 * * * * (每 10 分钟)
   ```

**或使用 UptimeRobot**（免费）：

1. 访问：https://uptimerobot.com
2. 注册账号
3. 添加 Monitor：
   ```
   Monitor Type: HTTP(s)
   URL: https://live-platform-api.onrender.com/health
   Monitoring Interval: 5 minutes
   ```

#### 方法 B：升级到 Railway（更好的免费版）

Railway 的免费版不会自动休眠，只是有 500 小时/月的限制（够用）。

**迁移到 Railway**：

1. 访问：https://railway.app
2. 使用 GitHub 登录
3. **New Project** → **Deploy from GitHub repo**
4. 配置和 Render 一样
5. 部署后更新前端的 `NEXT_PUBLIC_API_BASE_URL`

---

### 2. LiveKit Cloud 免费额度限制

**50GB 流量/月** 是什么概念？

```
假设：
- 视频码率：1.5 Mbps（720p）
- 每场直播：1 小时
- 平均观众：5 人

流量计算：
1.5 Mbps × 3600s ÷ 8 × 5 人 = 3.375 GB/场

免费额度支持：
50 GB ÷ 3.375 GB = 约 15 场直播/月
```

**超出后怎么办？**

- LiveKit Cloud 会自动停止服务
- 你会收到邮件通知
- 解决方案：升级到付费计划（$0.15/GB）或自建 LiveKit

---

### 3. Vercel 免费版限制

**100GB 流量/月** 通常够用，因为：

- Next.js 静态资源会被 CDN 缓存
- 主要流量在 LiveKit（视频流不走 Vercel）
- 100GB 约等于 10 万次页面访问

**超出后怎么办？**

- Vercel 会暂停服务
- 升级到 Pro 计划（$20/月）

---

### 4. Supabase 免费版限制

**500MB 数据库** 够用吗？

```
估算：
- 1 个用户记录：约 500 字节
- 1 条消息记录：约 200 字节
- 1 个房间记录：约 1 KB

500 MB 可存储：
- 100 万个用户
- 250 万条消息
- 50 万个房间

结论：对于初期来说，完全够用！
```

**超出后怎么办？**

- 升级到 Pro 计划（$25/月）
- 或者迁移到其他数据库

---

## 📊 免费方案总结

### ✅ 优点

1. **零成本**：所有服务都免费
2. **快速上线**：30 分钟部署完成
3. **自动扩展**：Vercel 和 Render 自动扩容
4. **全球 CDN**：Vercel 自带全球加速
5. **SSL 证书**：所有服务自带 HTTPS

### ⚠️ 缺点

1. **后端会休眠**：Render 15 分钟无请求会休眠（用 UptimeRobot 解决）
2. **冷启动慢**：休眠后首次访问需要 30-60 秒
3. **流量限制**：LiveKit 50GB/月，Vercel 100GB/月
4. **性能一般**：免费服务器性能不如付费

### 💡 什么时候需要升级？

**保持免费**，如果：
- ✅ 每月直播 < 15 场
- ✅ 平均观众 < 10 人
- ✅ 可以接受冷启动延迟

**需要升级**，如果：
- ❌ 每月直播 > 20 场
- ❌ 平均观众 > 20 人
- ❌ 需要 24/7 在线（无休眠）
- ❌ 需要自定义域名和企业级支持

---

## 🔧 部署后的维护

### 1. 监控服务状态

使用 UptimeRobot 监控所有服务：

```
1. Vercel: https://your-app.vercel.app
2. Render: https://live-platform-api.onrender.com/health
3. Supabase: 在控制台查看
4. LiveKit Cloud: 在控制台查看
```

### 2. 查看日志

- **Vercel**：项目 → Deployments → 选择部署 → Function Logs
- **Render**：项目 → Logs
- **Supabase**：项目 → Database → Logs

### 3. 更新代码

```bash
# 1. 本地修改代码
git add .
git commit -m "Update feature"
git push origin main

# 2. Vercel 和 Render 会自动重新部署（约 5 分钟）
```

---

## 🚀 一键部署脚本

创建 `scripts/deploy-free.sh`：

```bash
#!/bin/bash

echo "🚀 开始部署到免费服务..."

# 1. 推送代码到 GitHub
git add .
git commit -m "Deploy to free services"
git push origin main

# 2. 部署数据库
echo "📦 部署数据库迁移..."
cd packages/db
pnpm prisma migrate deploy

# 3. Vercel 和 Render 会自动部署
echo "✅ 代码已推送，等待 Vercel 和 Render 自动部署..."
echo "📊 可以访问以下链接查看部署状态："
echo "   - Vercel: https://vercel.com/dashboard"
echo "   - Render: https://dashboard.render.com"

echo "🎉 部署完成！"
```

---

## 📝 环境变量清单

### 后端 (Render)

```bash
NODE_ENV=production
PORT=10000
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.xxx.supabase.co:5432/postgres
REDIS_URL=https://xxx.upstash.io
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
JWT_SECRET=your-super-secret-key-min-32-chars
WEB_ORIGIN=https://your-app.vercel.app
```

### 前端 (Vercel)

```bash
NEXT_PUBLIC_API_BASE_URL=https://live-platform-api.onrender.com
NEXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud
NEXTAUTH_SECRET=another-random-secret-min-32-chars
NEXTAUTH_URL=https://your-app.vercel.app
```

---

## 🎯 下一步

1. **测试功能**：创建房间、直播、聊天
2. **监控流量**：关注 LiveKit 和 Vercel 的用量
3. **收集反馈**：看用户是否喜欢
4. **考虑升级**：流量大了再考虑付费

---

## 💬 常见问题

### Q1: Render 休眠怎么办？

**A**: 使用 UptimeRobot 每 5 分钟 ping 一次，保持唤醒。

### Q2: 免费额度用完了怎么办？

**A**:
- LiveKit 超额：升级到付费或自建（¥420/年）
- Vercel 超额：升级到 Pro（$20/月）
- Supabase 超额：升级到 Pro（$25/月）

### Q3: 能支持多少人同时在线？

**A**:
- Render 免费版：512MB RAM，约 10-20 人
- LiveKit Cloud 免费版：流量限制，约 10-15 场直播/月

### Q4: 延迟高吗？

**A**:
- LiveKit：延迟 < 500ms（和付费版一样）
- API：冷启动 30-60s，正常运行延迟 < 200ms
- 前端：Vercel 全球 CDN，延迟很低

### Q5: 数据会丢失吗？

**A**:
- 不会！所有数据都持久化在 Supabase
- 即使 Render 休眠，数据也不会丢失

---

## 🎉 总结

使用这套免费方案：

✅ **成本**: ¥0/月
✅ **部署时间**: 30 分钟
✅ **支持流量**: 15 场直播/月，每场 10 人
✅ **适用场景**: 初期测试、小流量项目

等有一定用户量后，再考虑升级到付费方案！

需要帮忙部署吗？我可以一步步指导你！
