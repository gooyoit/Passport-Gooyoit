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

## 生产部署

### 前端（Vercel）

Login 和 Admin 前端已部署到 Vercel：

| 项目 | 域名 | 仓库目录 |
|---|---|---|
| Login | https://passport.gooyoit.com | `frontend/login` |
| Admin | https://passport-admin.gooyoit.com | `frontend/admin` |

**Vercel 环境变量配置：**

Login 项目 → Settings → Environment Variables：

| Name | Value |
|---|---|
| `VITE_API_BASE` | `http://<服务器IP>:8000` |

Admin 项目 → Settings → Environment Variables：

| Name | Value |
|---|---|
| `VITE_API_BASE` | `http://<服务器IP>:8081` |

### 后端（阿里云服务器）

#### 1. 服务器环境准备

```bash
# 安装 Python 3.12+
# 安装 MySQL 8.0+ 并创建数据库
mysql -u root -p -e "CREATE DATABASE passport CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 安装 Redis
sudo apt install redis-server   # Ubuntu/Debian
sudo systemctl enable redis-server
```

#### 2. 部署 Login 后端（端口 8000）

```bash
# 克隆代码
git clone git@github.com:gooyoit/Passport-Gooyoit.git
cd Passport-Gooyoit/backend/login

# 安装依赖
pip install uv
uv sync

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入实际配置：
#   DATABASE_URL=mysql+pymysql://user:password@127.0.0.1:3306/passport
#   REDIS_URL=redis://127.0.0.1:6379/0
#   SECRET_KEY=<至少32位的随机字符串>
#   RESEND_API_KEY=<你的Resend API Key>
#   FRONTEND_ORIGINS=["https://passport.gooyoit.com"]
#   COOKIE_SECURE=false          # 没有HTTPS时设为false
#   DEBUG=false

# 初始化数据库
alembic upgrade head

# 使用 systemd 管理进程（见下方）
```

#### 3. 部署 Admin 后端（端口 8081）

```bash
cd Passport-Gooyoit/backend/admin

# 安装依赖
uv sync

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入实际配置：
#   DATABASE_URL=mysql+pymysql://user:password@127.0.0.1:3306/passport
#   SECRET_KEY=<至少32位的随机字符串>
#   CORS_ORIGINS=["https://passport-admin.gooyoit.com"]
#   PASSPORT_BASE_URL=http://127.0.0.1:8000
#   DEBUG=false
```

#### 4. Systemd 服务配置

创建 `/etc/systemd/system/passport-login.service`：

```ini
[Unit]
Description=Passport Login Service
After=network.target mysql.service redis.service

[Service]
User=www-data
Group=www-data
WorkingDirectory=/opt/Passport-Gooyoit/backend/login
ExecStart=/opt/Passport-Gooyoit/backend/login/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=3
EnvironmentFile=/opt/Passport-Gooyoit/backend/login/.env

[Install]
WantedBy=multi-user.target
```

创建 `/etc/systemd/system/passport-admin.service`：

```ini
[Unit]
Description=Passport Admin Service
After=network.target mysql.service

[Service]
User=www-data
Group=www-data
WorkingDirectory=/opt/Passport-Gooyoit/backend/admin
ExecStart=/opt/Passport-Gooyoit/backend/admin/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8081
Restart=always
RestartSec=3
EnvironmentFile=/opt/Passport-Gooyoit/backend/admin/.env

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable passport-login passport-admin
sudo systemctl start passport-login passport-admin

# 查看状态
sudo systemctl status passport-login
sudo systemctl status passport-admin

# 查看日志
sudo journalctl -u passport-login -f
sudo journalctl -u passport-admin -f
```

#### 5. 更新部署

```bash
cd /opt/Passport-Gooyoit
git pull
cd backend/login && uv sync && alembic upgrade head
cd ../admin && uv sync
sudo systemctl restart passport-login passport-admin
```

#### 6. 阿里云安全组

确保以下端口在安全组中放行：

| 端口 | 用途 |
|---|---|
| 8000 | Login 后端 API |
| 8081 | Admin 后端 API |
| 3306 | MySQL（仅内网） |
| 6379 | Redis（仅内网） |

> **安全提示：** MySQL 和 Redis 不要暴露到公网，只在 127.0.0.1 监听即可。
