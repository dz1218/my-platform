# Radio Friday 手机号认证

登录仅接受中国大陆手机号和密码。注册分两步：短信验证手机号，再提交密码、确认密码、性别和互动说明同意状态；账号只在完成密码设置时创建。注册完成继续进入原有身份选择流程。

## 配置与启动

服务端 `apps/server/.env` 配置以下变量，部署环境同样需要设置；前端不读取密钥：

```dotenv
ALIBABA_CLOUD_ACCESS_KEY_ID=
ALIBABA_CLOUD_ACCESS_KEY_SECRET=
SMS_SIGN_NAME=恒创联众
SMS_TEMPLATE_CODE=100001
SMS_CODE_PARAMETER=code
```

使用阿里云号码认证服务（PNVS）`SendSmsVerifyCode`，域名 `dypnsapi.aliyuncs.com`，API 版本 `2017-05-25`。`100001` 是号码认证服务的登录/注册赠送模板，不能传给普通短信服务的 `SendSms`。账号必须开通号码认证短信功能，密钥需具备 `dypns:SendSmsVerifyCode` 权限。

模板参数包含 `code` 和 `min`（5 分钟）。本服务生成随机 6 位验证码并传给阿里云发送，核验由本服务完成。提供商失败时不回显其完整响应、签名请求或验证码，只记录错误码和请求 ID。

启动 Go API 时自动应用 `012_phone_auth.sql`，也可先执行 `pnpm db:migrate`。修改 Go 代码或环境后需重启 API。数据库和 Redis 都须正常运行。

## 数据与限制

- 原有 email 列改为可空，账号及业务数据保留；旧邮箱账号不会被自动关联到任何手机号，因此未绑定手机号的旧账号无法通过新登录入口登录。上线前应核实归属后单独迁移绑定，禁止仅凭相同昵称绑定。
- 新账号使用唯一 phone 列，密码仍由 bcrypt 哈希。
- 验证码仅保存带服务端密钥的 HMAC，5 分钟有效，最多尝试 5 次。
- 手机号每 60 秒可发送一次，每 24 小时最多 10 次；请求来源另受 Redis 每分钟 5 次发送、20 次核验的限制。
- 验证成功返回 10 分钟有效、与手机号绑定的一次性随机凭证，凭证仅保存 HMAC。验证码立即失效。
- 注册在同一数据库事务中消费凭证并写入账号；并发请求只能创建一个账号。
- 提供商返回失败或超时也保留发送间隔，防止不确定发送结果触发重复短信。
- 不包含固定验证码、验证码日志或生产绕过逻辑。未配置服务时明确返回不可用。

接口：`POST /auth/code`（phone）、`POST /auth/verify`（phone, code）、`POST /auth/register`（phone, ticket, password, name, gender, consent）、`POST /auth/login`（phone, password）。Next.js server actions 保留现有 HttpOnly session cookie 行为。

## 找回与修改密码

- 登录页的「忘记密码」进入 `/forgot-password`：验证注册手机号后设置新密码。登录状态下也可使用；未注册号码返回统一受理提示，不发送短信或创建账号。
- 「我的」页的「修改密码」使用原密码验证。两种流程均要求确认新密码，保持 UTF-8 8–72 字节限制，拒绝与原密码相同的新密码；新哈希使用 bcrypt，原密码兼容旧 scrypt。
- 服务端复用 PNVS 配置，`SMS_RESET_TEMPLATE_CODE` 默认 `100003`（重置密码）；`SMS_TEMPLATE_CODE` 继续用于注册，不需要改动现有签名或密钥。
- 新接口（均在 `/api/v1` 下）：`POST /auth/password/code`（phone）、`POST /auth/password/verify`（phone, code）、`POST /auth/password/reset`（phone, ticket, password）、`POST /me/password`（currentPassword, newPassword）。最后一个接口要求登录，账户 ID 来自登录凭证。
- 找回记录独立保存在 `password_reset_verifications`，HMAC 包含用途、手机号和会话版本。验证码 5 分钟有效、最多尝试 5 次；一次性凭证 10 分钟有效；每 60 秒发送一次、24 小时最多 10 次。消费成功保留发送限额记录。Redis 限制发送来源，修改接口额外限制每账户每分钟 5 次。
- 密码更新、凭证消费、其余找回凭证作废、`users.session_version` 递增及 `account_revocations` 清理任务在同一 PostgreSQL 事务中提交。旧 JWT 缺少版本时视为 0，仅在账户版本仍为 0 时有效；新 JWT 使用验证密码时读取的版本。数据库鉴权失败不会放行。
- 成功后清除当前浏览器 Cookie，并以完整文档导航返回登录页。其他设备的旧 Cookie、Bearer 和已登录 socket 票据失效；已有业务连接在读写及 20 秒心跳复核后发出 `session.invalidated`，前端核验 `/me` 后清空私有缓存、释放连接并退出。
- API 的直播维护生命周期消费持久化清理任务，关闭旧会话版本的直播间。房间版本同时记录在服务端生命周期和 LiveKit metadata 中，任务按版本、房间 SID 复核，避免误关新房间；失败保留任务并退避重试。LiveKit 未启用时保留待处理任务。
- 监控未完成任务可查询 `SELECT user_id, session_version, attempts, retry_at FROM account_revocations WHERE completed_at IS NULL ORDER BY retry_at`；失败日志为 `account live cleanup pending` 或 `account cleanup queue unavailable`。日志不包含密码、验证码或票据。

升级需先应用 `014_password_recovery.sql`，再更新全部 API 实例，最后发布前端。不要长期混跑旧版 API，旧版只校验 JWT 签名，无法识别已撤销版本。应用启动会自动执行迁移；生产迁移应先备份，回滚时保留新增字段和表，且不得回滚到不检查会话版本的鉴权实现。

专项验证：`AUTH_INTEGRATION=1 GOCACHE=/tmp/my-platform-go-cache go test ./internal/auth` 使用本地 PostgreSQL 临时 schema 和短信替身；`PLAYWRIGHT_CHANNEL=chrome pnpm --filter web exec playwright test tests/password.spec.ts` 使用独立内存账号。真实短信送达需单独验证，固定验证码仅存在于测试 fixture。

## 验证

```sh
cd apps/server
AUTH_INTEGRATION=1 GOCACHE=/tmp/my-platform-go-cache go test ./internal/auth -v
```

集成测试使用本地数据库的临时 schema，结束后移除；短信发送使用替身，不发送真实短信。可用 `AUTH_TEST_DATABASE_URL` 指定独立数据库。

```sh
PLAYWRIGHT_CHANNEL=chrome pnpm --filter web exec playwright test tests/auth-form.spec.ts tests/identity-inheritance.spec.ts
```

浏览器测试覆盖验证码错误、重发倒计时、密码确认、性别选择、登录、注册后身份选择、场景切换和移动布局。真实短信送达仍需使用真实手机号单独验证。

官方参考：[短信验证码接口](https://help.aliyun.com/zh/pnvs/developer-reference/api-dypnsapi-2017-05-25-sendsmsverifycode)、[ACS3 签名](https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature)。
