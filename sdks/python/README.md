# passport-gooyoit (Python)

接入 [Passport Gooyoit](../../README.md) SSO 的 Python 客户端 SDK，封装 OAuth 2.0 授权码流程与 RBAC 权限校验。

## 安装

```bash
uv add passport-gooyoit            # 纯客户端
uv add "passport-gooyoit[fastapi]" # 带 FastAPI 集成
```

## 快速开始（纯客户端）

```python
from passport_gooyoit import PassportClient

passport = PassportClient(
    api_base_url="https://api.gooyoit.com:8443",  # Passport API
    login_url="https://passport.gooyoit.com",     # 登录页
    client_id="YOUR_CLIENT_ID",
    client_secret="YOUR_CLIENT_SECRET",           # 仅限服务端使用，勿放前端
)

# 1. 生成跳转 URL（state 自动生成，请存入 session 以便回调时校验）
url, state = passport.authorization_url(
    redirect_uri="https://app.example.com/auth/callback",
    application_name="My App",
)

# 2. 回调处理：校验 state，用 code 换 token（一次拿到 user + roles + permissions）
token = passport.exchange_code(code, redirect_uri="https://app.example.com/auth/callback")

# 3. 任意时刻实时查询用户身份与权限
info = passport.get_userinfo(token.access_token)

# 4. 刷新 / 登出
token = passport.refresh(token.refresh_token)
passport.logout(token.refresh_token)
```

## FastAPI 集成

```python
from fastapi import Depends, FastAPI
from passport_gooyoit import PassportClient
from passport_gooyoit.fastapi import PassportAuth
from passport_gooyoit.types import UserInfoResponse

passport = PassportClient(api_base_url=..., login_url=..., client_id=..., client_secret=...)
auth = PassportAuth(passport, cache_ttl=60)  # token→userinfo 缓存 60s

app = FastAPI()

@app.get("/me")
def me(user: UserInfoResponse = Depends(auth.current_user)):
    return user

@app.get("/articles")
def list_articles(user=Depends(auth.require_permission("user.read"))):
    return [...]  # 无权限自动 403

@app.get("/admin")
def admin(user=Depends(auth.require_role("admin"))):
    return {...}
```

`require_permission` / `require_role` 可传多个 code（AND 语义，须全部满足）；依赖解析链路为 `Bearer token → /oauth/userinfo（带 TTL 缓存）→ 401/403`。

## API 概览

| 方法 | 说明 |
|---|---|
| `authorization_url(redirect_uri, state=None, application_name=None)` | `(url, state)`, automatically generates a cryptographically secure `state` if not provided |
| `verify_state(expected, received)` | Constant-time `state` validation (CSRF protection) |
| `exchange_code(code, redirect_uri)` | `TokenResponse` (includes `user`/`roles`/`permissions`) |
| `refresh(refresh_token)` | `TokenResponse` |
| `get_userinfo(access_token)` | `UserInfoResponse`, permissions calculated in real time |
| `logout(refresh_token=None)` | Revoke `refresh_token`. Note: Revoking the Passport SSO session ("global logout") requires the browser-side SSO cookie; direct the user's browser to the Passport logout page to implement it |

## 错误处理

```python
from passport_gooyoit import PassportAuthError, PassportUnavailableError

try:
    token = passport.exchange_code(code, redirect_uri)
except PassportAuthError as exc:             # 400/401/403（业务性拒绝）
    logger.warning("passport rejected: %s (%s)", exc.detail, exc.status_code)
except PassportUnavailableError as exc:      # 网络故障 / 超时，Passport 不可达
    logger.error("passport unreachable: %s", exc)
```

## 开发

```bash
cd sdks/python
uv sync --extra dev
uv run pytest
```

Tests are entirely based on `respx` mocks and do not depend on a real Passport service.
