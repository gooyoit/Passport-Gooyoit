# 部署指南

## 架构概览

```
用户浏览器
  ├── https://passport.gooyoit.com          → Vercel (Login 前端)
  ├── https://passport-admin.gooyoit.com     → Vercel (Admin 前端)
  ├── https://api.gooyoit.com:8443           → Nginx → Login 后端 (:8080)
  └── https://admin-api.gooyoit.com:8443     → Nginx → Admin 后端 (:8081)
```

---

## 一、前端部署（Vercel）

### 步骤

1. 代码推到 GitHub
2. 打开 https://vercel.com ，用 GitHub 登录
3. 分别导入 `frontend/login` 和 `frontend/admin` 项目
4. Vercel 会自动检测 Vite 框架，保持默认设置即可

### 环境变量

Login 项目 → Settings → Environment Variables：

| Name | Value |
|---|---|
| `VITE_API_BASE` | `https://api.gooyoit.com:8443` |

Admin 项目 → Settings → Environment Variables：

| Name | Value |
|---|---|
| `VITE_API_BASE` | `https://admin-api.gooyoit.com:8443` |
| `VITE_PASSPORT_URL` | `https://passport.gooyoit.com` |
| `VITE_CLIENT_ID` | Admin 应用的 client_id |

### 绑定自定义域名

在 Vercel 项目的 Settings → Domains 中添加域名。然后在阿里云 DNS 控制台添加 CNAME 记录：

| 类型 | 主机记录 | 记录值 |
|---|---|---|
| CNAME | passport | `cname.vercel-dns.com` |
| CNAME | passport-admin | `cname.vercel-dns.com` |

DNS 生效后 Vercel 会自动签发 SSL 证书。

---

## 二、服务器环境准备

### 1. 基础软件

```bash
# 安装 Python 3.12+（Ubuntu 22.04+）
sudo apt update
sudo apt install python3.12 python3.12-venv python3-pip -y

# 安装 uv（Python 包管理器）
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc

# 安装 MySQL 8.0+
sudo apt install mysql-server -y
sudo mysql_secure_installation

# 创建数据库
sudo mysql -u root -p -e "CREATE DATABASE passport CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 安装 Redis
sudo apt install redis-server -y
sudo systemctl enable redis-server
sudo systemctl start redis-server
```

### 2. 克隆代码

```bash
git clone git@github.com:gooyoit/Passport-Gooyoit.git /data/apps/passport-gooyoit
```

---

## 三、部署后端服务

### 1. 部署 Login 后端（端口 8080）

```bash
cd /data/apps/passport-gooyoit/backend/login
cp .env.example .env
```

编辑 `.env`：

```env
APP_NAME="Gooyoit Passport"
DEBUG=false
DATABASE_URL=mysql+pymysql://user:password@127.0.0.1:3306/passport?charset=utf8mb4
REDIS_URL=redis://127.0.0.1:6379/0
SECRET_KEY=<用 python3 -c "import secrets; print(secrets.token_urlsafe(48))" 生成>
JWT_ISSUER=gooyoit-passport
COOKIE_SECURE=false
FRONTEND_ORIGINS=["https://passport.gooyoit.com","https://passport-admin.gooyoit.com"]
RESEND_API_KEY=<你的Resend API Key>
```

安装依赖并初始化数据库：

```bash
uv sync
alembic upgrade head
```

### 2. 部署 Admin 后端（端口 8081）

```bash
cd /data/apps/passport-gooyoit/backend/admin
cp .env.example .env
```

编辑 `.env`：

```env
APP_NAME="Gooyoit Passport Admin"
DEBUG=false
DATABASE_URL=mysql+pymysql://user:password@127.0.0.1:3306/passport?charset=utf8mb4
SECRET_KEY=<同上或单独生成>
JWT_ISSUER=gooyoit-passport
PASSPORT_API_URL=https://api.gooyoit.com:8443
ADMIN_CLIENT_ID=<从Login后端获取>
ADMIN_CLIENT_SECRET=<从Login后端获取>
CORS_ORIGINS=["https://passport-admin.gooyoit.com"]
```

安装依赖：

```bash
uv sync
```

### 3. 注册 Systemd 服务

创建 `/etc/systemd/system/passport-login.service`：

```ini
[Unit]
Description=Passport Login Service
After=network.target mysql.service redis.service

[Service]
User=root
WorkingDirectory=/data/apps/passport-gooyoit/backend/login
ExecStart=/data/apps/passport-gooyoit/backend/login/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8080 --access-log --log-level info
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
EnvironmentFile=/data/apps/passport-gooyoit/backend/login/.env

[Install]
WantedBy=multi-user-target
```

创建 `/etc/systemd/system/passport-admin.service`：

```ini
[Unit]
Description=Passport Admin Service
After=network.target mysql.service

[Service]
User=root
WorkingDirectory=/data/apps/passport-gooyoit/backend/admin
ExecStart=/data/apps/passport-gooyoit/backend/admin/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8081 --access-log --log-level info
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
EnvironmentFile=/data/apps/passport-gooyoit/backend/admin/.env

[Install]
WantedBy=multi-user-target
```

启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable passport-login passport-admin
sudo systemctl start passport-login passport-admin
```

---

## 四、Nginx + SSL 反向代理

未备案域名无法使用阿里云的 80/443 端口，使用 Nginx 在非标准端口（8443）提供 HTTPS。

### 1. 安装 Nginx

```bash
sudo apt install nginx -y
sudo systemctl enable nginx
```

### 2. 安装 acme.sh 并申请通配符证书

通配符证书 `*.gooyoit.com` 覆盖所有子域名，只需申请一次。

**创建阿里云 DNS API 密钥：**

阿里云控制台 → AccessKey 管理 → 创建子账号 → 只授权 `AliyunDNSFullAccess`，记录 AccessKey ID 和 Secret。

```bash
# 安装 acme.sh
curl https://get.acme.sh | sh
source ~/.bashrc

# 设置阿里云 DNS 凭证
export Ali_Key="你的AccessKey_ID"
export Ali_Secret="你的AccessKey_Secret"

# 切换 CA 为 Let's Encrypt（默认 CA 可能不支持通配符）
~/.acme.sh/acme.sh --set-default-ca --server letsencrypt

# 申请通配符证书（--dnssleep 120 等待 DNS 传播，阿里云免费版需要）
~/.acme.sh/acme.sh --issue --dns dns_ali \
  -d "*.gooyoit.com" -d "gooyoit.com" \
  --dnssleep 120

# 安装证书到 Nginx
sudo mkdir -p /etc/nginx/ssl
~/.acme.sh/acme.sh --install-cert -d "*.gooyoit.com" \
  --key-file /etc/nginx/ssl/gooyoit.com.key \
  --fullchain-file /etc/nginx/ssl/gooyoit.com.pem \
  --reloadcmd "systemctl reload nginx"
```

> 证书自动续期，无需手动维护。

### 3. 配置 Nginx

创建 `/etc/nginx/sites-available/passport.gooyoit.com`：

```nginx
server {
    listen 8443 ssl;
    server_name api.gooyoit.com admin-api.gooyoit.com;

    ssl_certificate /etc/nginx/ssl/gooyoit.com.pem;
    ssl_certificate_key /etc/nginx/ssl/gooyoit.com.key;

    location / {
        set $upstream "";
        if ($host = api.gooyoit.com)        { set $upstream 127.0.0.1:8080; }
        if ($host = admin-api.gooyoit.com)  { set $upstream 127.0.0.1:8081; }
        proxy_pass http://$upstream;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用配置：

```bash
sudo ln -sf /etc/nginx/sites-available/passport.gooyoit.com /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 4. 阿里云 DNS 解析记录

在阿里云 DNS 控制台添加：

| 类型 | 主机记录 | 记录值 |
|---|---|---|
| CNAME | passport | `cname.vercel-dns.com` |
| CNAME | passport-admin | `cname.vercel-dns.com` |
| A | api | `119.23.238.217` |
| A | admin-api | `119.23.238.217` |

### 5. 阿里云安全组

入方向放行：

| 端口 | 协议 | 用途 |
|---|---|---|
| 8443 | TCP | Nginx HTTPS（前端 API 请求） |
| 3306 | TCP | MySQL（仅限 127.0.0.1，不开公网） |
| 6379 | TCP | Redis（仅限 127.0.0.1，不开公网） |

> **安全提示：** 8080 和 8081 仅通过 Nginx 代理访问，不要在安全组开放。

---

## 五、验证

```bash
# 检查后端服务状态
sudo systemctl status passport-login
sudo systemctl status passport-admin

# 检查 API（通过 Nginx HTTPS）
curl https://api.gooyoit.com:8443/healthz
curl https://admin-api.gooyoit.com:8443/config

# 查看日志
sudo journalctl -u passport-login -f
sudo journalctl -u passport-admin -f
sudo journalctl -u nginx -f
```

访问前端页面确认登录流程正常：
- https://passport.gooyoit.com
- https://passport-admin.gooyoit.com

---

## 六、更新部署

```bash
cd /data/apps/passport-gooyoit
git pull

# 更新 Login
cd backend/login && uv sync && alembic upgrade head

# 更新 Admin
cd ../admin && uv sync

# 重启服务
sudo systemctl restart passport-login passport-admin
```
