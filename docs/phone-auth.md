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
