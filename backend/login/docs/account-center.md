# 账号补全（Account Center）接入指南

面向接入 Passport 的业务系统开发者。当用户通过第三方登录（微信等）首次进入业务系统、且跳过了账号完善步骤时，业务系统可以通过本套接口检测并帮助用户补绑邮箱 / 设置密码，让用户后续也能用「用户名或邮箱 + 密码」登录。

配置与账号体系说明参见根目录 `INTEGRATION.md`；第三方登录配置参见 `oauth-providers.md`。

## 两种接入姿势

| 姿势 | 适用场景 | 说明 |
|---|---|---|
| A. 跳转 Passport 账号中心 | 不想自己做表单 | 在"个人设置"等页面放一个链接指向 `https://passport.gooyoit.com/account/settings`。用户在 Passport 域内凭 SSO 会话直接管理绑定，业务系统零开发量。 |
| B. 业务系统内嵌表单直调 API | 希望体验内聚在自己的产品里 | 用户登录后业务系统持有其 access_token，用它代用户调用下述 `/account/*` 接口。推荐由业务系统**服务端**转发调用。 |

两种姿势可以同时使用；底层是同一套接口。

## 第 1 步：检测用户是否需要补全

现有 `GET /oauth/userinfo` 已扩展两个字段（纯新增，不影响既有接入方）：

```bash
curl -H "Authorization: Bearer <access_token>" \
  https://passport.gooyoit.com/api/oauth/userinfo
```

```json
{
  "user": { "id": 42, "username": null, "email": null, "display_name": "微信用户", "status": "active" },
  "roles": ["member"],
  "permissions": [],
  "has_password": false,
  "identities": [
    { "provider": "wechat", "provider_email": null }
  ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `has_password` | bool | 用户是否设置了密码 |
| `identities` | array | 已绑定的登录凭证。`provider` 取值 `wechat` / `google` / `github` / `email`；`provider_email` 为该凭证关联的邮箱（可能为 null） |

**推荐检测逻辑**（伪码）：

```
if not has_password or 不存在 provider == "email" 的 identity:
    在"个人设置"等入口显示「完善账号资料」引导
```

## 第 2 步：代用户补绑（姿势 B）

所有接口共用认证方式：`Authorization: Bearer <access_token>`（即 `/oauth/token` 换到的 access token，有效期 2 小时）。通用错误：

| 状态码 | 含义 |
|---|---|
| 401 | 未带 token / token 无效或过期 |
| 403 | 用户被禁用 |
| 429 | 触发速率限制（响应头含 `Retry-After` 秒数） |

### 查询当前账号 `GET /account/profile`

```bash
curl -H "Authorization: Bearer <access_token>" \
  https://passport.gooyoit.com/api/account/profile
```

```json
{
  "user": {
    "id": 42, "username": null, "email": null, "email_verified": false,
    "contact_phone": null, "display_name": "微信用户", "avatar_url": "https://…", "status": "active"
  },
  "has_password": false,
  "identities": [{ "provider": "wechat", "provider_email": null }]
}
```

### 绑定邮箱 `POST /account/email/bind`

| 参数 | 必填 | 说明 |
|---|---|---|
| `email` | 是 | 待绑定邮箱 |

```bash
curl -X POST -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}' \
  https://passport.gooyoit.com/api/account/email/bind
```

成功返回最新的 profile（同 `GET /account/profile`），前端无需二次拉取。

说明：

- 绑定是用户的主动操作，**只校验邮箱格式，不验证所有权**（不发验证码邮件）。绑定后该邮箱即可配合密码登录（密码本身即所有权证明）。
- 邮箱已被其他账号绑定（`409`）或用户已绑定其他邮箱（`409`，当前版本不支持换绑）时返回错误。
- 重复绑定同一邮箱幂等成功。
- 由于未验证所有权，返回的 `email_verified` 保持 `false`；**业务系统不应依赖 `email` 做权限判定**，如需按邮箱授权请自行验证。

错误：`409` 邮箱已被其他账号绑定，或用户已绑定其他邮箱。

### 合并进已有账号 `POST /account/link-existing`

适用于「绑定」而非「完善」的场景：用户原本就有 Passport 本地账号（用户名/邮箱 + 密码），微信扫码时跳过完善产生了一个新账号，现在希望把微信身份**并回原账号**。

| 参数 | 必填 | 说明 |
|---|---|---|
| `identifier` | 是 | 已有账号的用户名或邮箱 |
| `password` | 是 | 已有账号的密码（所有权证明） |

```bash
curl -X POST -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"identifier": "alice", "password": "她的密码"}' \
  https://passport.gooyoit.com/api/account/link-existing
```

```json
{
  "profile": {
    "user": { "id": 7, "username": "alice", "email": "alice@example.com", "email_verified": true, "contact_phone": null, "display_name": "Alice", "avatar_url": null, "status": "active" },
    "has_password": true,
    "identities": [
      { "provider": "email", "provider_email": "alice@example.com" },
      { "provider": "wechat", "provider_email": null }
    ]
  },
  "access_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "expires_in": 7200
}
```

合并动作与限制：

- 双重所有权证明：调用方的 token（证明拥有当前微信身份）+ 已有账号密码。
- 仅**空壳账号**（无密码、无邮箱，即跳过完善产生的账号）可被合并；已有自身凭据的账号返回 `409`。
- 微信 identity 与各应用成员关系移入目标账号；空壳账号及其会话、token 一并删除。
- 目标账号已绑定同类型第三方身份时返回 `409`。
- **Bearer 调用方必须在响应中拿新的 `access_token` 替换本地存储的旧 token**——旧 token 随空壳账号一起失效。refresh token 不再签发，请引导用户重新走授权或刷新会话。
- 下次微信扫码将直接以已有账号身份登录。

错误：`400` 两个账号已关联；`401` 密码错误或邮箱未验证；`403` 目标账号被禁用；`409` 不可合并。

### 设置用户名 / 密码 / 手机号 `POST /account/credentials`

| 参数 | 必填 | 校验 |
|---|---|---|
| `username` | 否 | 3-64 位小写字母、数字、下划线或连字符，且未被占用 |
| `password` | 否 | 8-128 位，至少包含大写/小写/数字/特殊字符中的三类 |
| `contact_phone` | 否 | 去除空格和括号后 7-20 位数字，可带 `+` 前缀 |
| `current_password` | 条件 | **覆盖已有密码时必填**；首次设置密码不需要 |

> **密码变更仅限 Passport 账号中心**：带 Bearer access_token 的调用（业务系统）**不能设置或修改密码**（返回 `403`）——应用级 token 不代表全局账号控制权。业务系统如需引导用户设置密码，请放一个链接跳转到 `https://passport.gooyoit.com/account/settings`（用户凭 SSO 会话直接操作）。用户名和手机号不受此限制。

```bash
curl -X POST -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"username": "alice", "password": "StrongPass1!"}' \
  https://passport.gooyoit.com/api/account/credentials
```

成功返回最新 profile。错误：`400` 三个可更新字段全空；`401` `current_password` 错误（连续失败会触发临时锁定）；`409` 用户名被占用；`422` 字段校验失败。

## 第 3 步：绑定成功后

用户即可在登录页使用「用户名或邮箱 + 密码」登录（`POST /auth/email/login-password`，见 `INTEGRATION.md`）。业务系统无需任何改动。

## 退出登录（必须顶层跳转）

业务系统与 Passport **不在同一个域名**时，`passport.gooyoit.com` 的 SSO cookie 不会随业务系统的 fetch 请求携带（浏览器的第三方 cookie 规则），因此 `POST /oauth/logout` 的 `global_logout` 在跨域场景下**无法撤销 SSO 会话**——用户"退出登录"后仍能进入 Passport 账号中心。

正确的退出姿势（RP-Initiated Logout，Auth0/Keycloak 同款模式）是**浏览器顶层跳转**到 Passport 的登出端点：

```js
// 业务系统退出时：先清理自己的会话，然后整页跳转
window.location.href =
  "https://passport.gooyoit.com/api/auth/logout" +
  "?client_id=" + encodeURIComponent("你的CLIENT_ID") +
  "&post_logout_redirect_uri=" + encodeURIComponent("https://your-app.example.com/login");
```

`GET /auth/logout` 会：撤销 Passport 的 SSO 会话 → 清除 SSO cookie → 302 跳转到 `post_logout_redirect_uri`。

| 参数 | 必填 | 说明 |
|---|---|---|
| `client_id` | 是 | 发起登出的业务系统的 client_id |
| `post_logout_redirect_uri` | 否 | 退出后的回跳地址。**必须与该 client_id 自己注册的 redirect_uri 同源**（协议+域名+端口一致），否则回跳 Passport 登录页 |

完整退出流程建议：

```
1. 业务系统清理本地会话（自己的 cookie/storage 里的 token）
2. 服务端调 POST /oauth/logout {refresh_token} 撤销 refresh token（可选但推荐）
3. window.location.href = "https://passport.gooyoit.com/api/auth/logout?post_logout_redirect_uri=..."
```

错误码：无（端点始终 302；无 cookie 时也正常返回）。

## 注意事项

1. **CORS**：浏览器端跨域直调时需将业务系统域名加入 Passport 的 `frontend_origins` 白名单；推荐业务系统由服务端转发调用，避免暴露 token 与 CORS 问题。
2. **token 窗口**：access_token 有效期 2 小时，过期后用 refresh_token 换新（`POST /oauth/token/refresh`）。
3. **不要在客户端解码 token**：将 access_token 视为 opaque 字符串。
4. **安全边界**：绑定邮箱为用户主动操作，仅校验格式不验证所有权（若业务上要求证明邮箱所有权，请自行发信确认）；覆盖已有密码必须提供当前密码，业务系统无法替用户绕过这道证明。
5. **退出必须顶层跳转**：见上文「退出登录」——跨域 fetch 撤不掉 SSO 会话。

## 集成场景示例

微信扫码登录的用户跳过了完善页：

```
1. 业务系统通过 /oauth/token 拿到 access_token
2. 调 GET /oauth/userinfo → has_password=false, identities 只有 wechat
3. 业务系统前端展示「完善账号资料」入口
4. 用户填写邮箱 → 业务系统调 POST /account/email/bind {email}
5. 用户设置密码 → POST /account/credentials {username, password}
6. 再次调 GET /oauth/userinfo → has_password=true, identities 含 email
```

用户填写的邮箱已被其他账号占用（bind 返回 409 "already bound to another account"），且用户确认那是自己的账号：

```
1. 前端提示切换为合并模式，收集已有账号的用户名/邮箱 + 密码
2. POST /account/link-existing {identifier, password}
3. 用响应中的新 access_token 替换旧 token；profile 即为目标账号
```
