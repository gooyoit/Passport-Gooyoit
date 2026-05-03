# 第三方 OAuth 登录配置示例

Passport 的 Google、GitHub、微信登录配置是按接入系统隔离的，保存在
`application_login_methods.config` 中。这样不同业务系统可以使用不同的第三方
OAuth 应用，也可以独立开启或关闭登录方式。

## 回调地址

在第三方平台创建 OAuth 应用时，回调地址填写 Passport 后端地址：

```text
Google: https://passport.example.com/oauth/providers/google/callback
GitHub: https://passport.example.com/oauth/providers/github/callback
微信:   https://passport.example.com/oauth/providers/wechat/callback
```

本地开发可使用：

```text
Google: http://127.0.0.1:8080/oauth/providers/google/callback
GitHub: http://127.0.0.1:8080/oauth/providers/github/callback
```

业务系统自己的回调地址仍然配置在 `applications.redirect_uris`，例如：

```text
https://console.example.com/auth/callback
```

第三方平台回调到 Passport，Passport 完成身份识别后，再通过内部授权码跳回业务系统回调地址。

## Google 登录方式配置

```bash
curl -X POST "http://127.0.0.1:8080/admin/applications/1/login-methods" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $ADMIN_API_TOKEN" \
  -d '{
    "method": "google",
    "enabled": true,
    "config": {
      "client_id": "GOOGLE_CLIENT_ID",
      "client_secret": "GOOGLE_CLIENT_SECRET",
      "server_metadata_url": "https://accounts.google.com/.well-known/openid-configuration",
      "scope": "openid email profile"
    }
  }'
```

必填字段：

- `client_id`
- `client_secret`

可选字段：

- `server_metadata_url`，默认使用 Google OpenID Connect Discovery 地址。
- `scope`，默认 `openid email profile`。

## GitHub 登录方式配置

```bash
curl -X POST "http://127.0.0.1:8080/admin/applications/1/login-methods" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $ADMIN_API_TOKEN" \
  -d '{
    "method": "github",
    "enabled": true,
    "config": {
      "client_id": "GITHUB_CLIENT_ID",
      "client_secret": "GITHUB_CLIENT_SECRET",
      "authorize_url": "https://github.com/login/oauth/authorize",
      "access_token_url": "https://github.com/login/oauth/access_token",
      "api_base_url": "https://api.github.com/",
      "scope": "read:user user:email"
    }
  }'
```

必填字段：

- `client_id`
- `client_secret`

可选字段：

- `authorize_url`，默认 `https://github.com/login/oauth/authorize`。
- `access_token_url`，默认 `https://github.com/login/oauth/access_token`。
- `api_base_url`，默认 `https://api.github.com/`。
- `scope`，默认 `read:user user:email`。

## 前端登录入口

登录页会根据当前 `client_id` 拼出第三方登录入口：

```text
GET /oauth/providers/google/authorize?client_id=APP_CLIENT_ID&redirect_uri=https%3A%2F%2Fconsole.example.com%2Fauth%2Fcallback&state=random-state
GET /oauth/providers/github/authorize?client_id=APP_CLIENT_ID&redirect_uri=https%3A%2F%2Fconsole.example.com%2Fauth%2Fcallback&state=random-state
```

完整访问登录页示例：

```text
http://127.0.0.1:5173/?client_id=APP_CLIENT_ID&redirect_uri=https%3A%2F%2Fconsole.example.com%2Fauth%2Fcallback&state=random-state
```

## 验证配置是否开启

```bash
curl "http://127.0.0.1:8080/oauth/providers/google?client_id=APP_CLIENT_ID"
curl "http://127.0.0.1:8080/oauth/providers/github?client_id=APP_CLIENT_ID"
```

返回示例：

```json
{
  "provider": "google",
  "enabled": true,
  "authorization_url": null
}
```

## 注意事项

- `client_secret` 目前保存在登录方式配置 JSON 中，生产环境建议改为加密存储或接入密钥管理服务。
- 后端必须配置 `SECRET_KEY`，因为 Authlib OAuth 流程会使用服务端 Session 保存临时上下文。
- 第三方平台配置的回调地址必须是 Passport 的 provider callback，不是业务系统回调地址。
- 业务系统换取 Token 时仍然使用 Passport 应用的 `client_id` 和 `client_secret`，不是 Google/GitHub 的密钥。
