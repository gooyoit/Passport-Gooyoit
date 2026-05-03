# Passport Gooyoit

统一登录、SSO、OAuth2 授权码交换、用户管理和 RBAC 权限控制服务。

## 项目结构

```
├── backend/
│   ├── login/          # Passport 登录/授权服务 (端口 8080)
│   └── admin/          # Admin 管理后台 API (端口 8081)
└── frontend/
    ├── login/          # 登录页面 (端口 5173)
    └── admin/          # 管理后台页面 (端口 5174)
```

## 快速开始

### 1. 启动后端

```bash
cd backend/login
cp .env.example .env
uv sync
alembic upgrade head
uv run uvicorn app.main:app --reload

cd ../admin
cp .env.example .env
uv sync
uv run uvicorn app.main:app --port 8081 --reload
```

API 文档：http://127.0.0.1:8080/docs | http://127.0.0.1:8081/docs

### 2. 启动前端

```bash
cd frontend/login && npm install && npm run dev
cd ../admin && npm install && npm run dev
```

访问 http://127.0.0.1:5173 / http://127.0.0.1:5174

### 运行测试

```bash
cd backend/login && uv run pytest
cd backend/admin && uv run pytest
```

## 生产域名

| 服务 | 地址 |
|---|---|
| Login 前端 | https://passport.gooyoit.com |
| Admin 前端 | https://passport-admin.gooyoit.com |
| Login API | https://api.gooyoit.com:8443 |
| Admin API | https://admin-api.gooyoit.com:8443 |

## 文档

| 文档 | 说明 |
|---|---|
| [INTEGRATION.md](./INTEGRATION.md) | 接入指南（OAuth 流程、第三方登录配置） |
| [DEPLOY.md](./DEPLOY.md) | 部署指南（服务器、Nginx、SSL、Vercel） |
