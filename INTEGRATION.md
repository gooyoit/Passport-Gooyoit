# 接入指南

## OAuth 2.0 标准流程

Passport 使用标准 OAuth 2.0 授权码流程，接入系统只需三步。

### 第 1 步：在 Passport Admin 创建应用

登录 Admin 管理后台，创建一个应用，获取 `client_id` 和 `client_secret`。

### 第 2 步：引导用户到 Passport 登录页

将用户跳转到 Passport 登录页，带上 `client_id`、`redirect_uri`、`state` 参数：

```
https://passport.gooyoit.com/?client_id=你的CLIENT_ID&redirect_uri=你的回调地址&state=随机字符串&application_name=你的应用名
```

| 参数 | 说明 |
|---|---|
| `client_id` | Admin 创建应用时分配 |
| `redirect_uri` | 用户登录成功后跳回你系统的地址，需在 Admin 中配置 |
| `state` | 随机字符串，用于防 CSRF，登录后会原样返回 |
| `application_name` | 可选，登录页标题会显示"登录到 xxx" |

> **安全提示：** `client_secret` 是接入系统的凭证，仅用于后端服务器之间的调用，**绝对不能暴露到前端代码中**。泄露后任何人都可冒充你的系统获取用户 Token。
| `state` | 随机字符串，用于防 CSRF，登录后会原样返回 |
| `application_name` | 可选，登录页标题会显示"登录到 xxx" |

### 第 3 步：用授权码换取 Token

用户登录成功后，Passport 会跳回你的 `redirect_uri`，带上 `code` 参数。用 `code` 调用 Token 接口：

```bash
POST https://api.gooyoit.com:8443/oauth/token
Content-Type: application/json

{
  "client_id": "你的CLIENT_ID",
  "client_secret": "你的CLIENT_SECRET",
  "code": "授权码",
  "redirect_uri": "你的回调地址"
}
```

返回：

```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "token_type": "bearer",
  "expires_in": 7200,
  "user": {
    "id": 1,
    "email": "user@example.com",
    "first_name": "John",
    "last_name": "Doe"
  },
  "roles": ["member"],
  "permissions": ["user.read"]
}
```

---

## 第三方登录配置

Passport 支持为每个接入系统独立配置 Google、GitHub、微信登录。不同业务系统可以使用不同的第三方 OAuth 应用。

### 回调地址

在第三方平台创建 OAuth 应用时，回调地址填写 Passport 后端地址：

| 平台 | 回调地址 |
|---|---|
| Google | `https://api.gooyoit.com:8443/oauth/providers/google/callback` |
| GitHub | `https://api.gooyoit.com:8443/oauth/providers/github/callback` |
| 微信 | `https://api.gooit.com:8443/oauth/providers/wechat/callback` |

本地开发时将域名替换为 `http://127.0.0.1:8080`。

### 各平台申请入口

#### Google

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建项目（或选择已有项目）
3. 左侧菜单 → **APIs & Services** → **Credentials**
4. 点击 **Create Credentials** → **OAuth client ID**
5. Application type 选 **Web application**
6. Authorized redirect URIs 填写上面的回调地址
7. 记录 `Client ID` 和 `Client Secret`

**所需权限：** `openid email profile`

#### GitHub

1. 打开 [GitHub Developer Settings](https://github.com/settings/developers)
2. 点击 **New OAuth App**
3. 填写 Application name、Homepage URL
4. Authorization callback URL 填写上面的回调地址
5. 点击 **Register application**
6. 点击 **Generate a new client secret**
7. 记录 `Client ID` 和 `Client Secret`

**所需权限：** `read:user user:email`

#### 微信

1. 打开 [微信开放平台](https://open.weixin.qq.com/) 并登录
2. 管理中心 → 网站应用 → 创建网站应用
3. 填写网站信息，提交审核
4. 审核通过后获取 `AppID` 和 `AppSecret`

> 微信登录需要企业认证，个人开发者无法直接申请。

### 启用登录方式

获取到第三方平台的 `client_id` 和 `client_secret` 后，通过 Admin 管理后台为应用启用对应登录方式。登录方式的配置是按应用隔离的，每个接入系统可以独立开关。

### 验证配置

```bash
curl https://api.gooyoit.com:8443/oauth/providers/google?client_id=你的CLIENT_ID
```

返回 `"enabled": true` 表示配置成功。
