# Passport Gooyoit

统一登录、SSO、OAuth2 授权码交换、用户管理和 RBAC 权限控制服务。

## 项目结构

```
├── backend/
│   ├── login/          # Passport 登录/授权服务 (端口 8000)
│   └── admin/          # Admin 管理后台 API (端口 8081)
└── frontend/
    ├── login/          # 登录页面 (端口 5173)
    └── admin/          # 管理后台页面 (端口 5174)
```

## 开发

### Login 后端 (端口 8000)

```bash
cd backend/login
cp .env.example .env
uv sync
alembic upgrade head
uv run uvicorn app.main:app --reload
```

API 文档：http://127.0.0.1:8000/docs

### Admin 后端 (端口 8081)

```bash
cd backend/admin
cp .env.example .env
uv sync
uv run uvicorn app.main:app --port 8081 --reload
```

API 文档：http://127.0.0.1:8081/docs

### Login 前端 (端口 5173)

```bash
cd frontend/login
npm install
npm run dev
```

### Admin 前端 (端口 5174)

```bash
cd frontend/admin
npm install
npm run dev
```

## 运行测试

```bash
cd backend/login
uv run pytest

cd backend/admin
uv run pytest
```

## 前端构建

```bash
cd frontend/login && npm run build
cd ../admin && npm run build
```

## 第三方 OAuth 登录

后端使用 Authlib 集成第三方 OAuth 提供商。在应用登录方式中启用 `wechat`、`google` 或 `github`，并配置对应的 `client_id` 和 `client_secret`。

详见：`backend/login/docs/oauth-providers.md`
