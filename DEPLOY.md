# 部署指南

## 生产架构

```text
https://passport.gooyoit.com
  - Nginx 静态托管 frontend/login/dist
  - /api/*、/auth/*、/oauth/* -> Login API 127.0.0.1:8080

https://passport-admin.gooyoit.com
  - Nginx 静态托管 frontend/admin/dist
  - /api/* -> Admin API 127.0.0.1:8081
```

生产服务器：`119.23.238.217`。

## 前端构建

Login 前端默认通过同域 `/api` 访问 Login API：

```bash
cd frontend/login
npm ci
npm run build
```

Admin 前端需要在构建时写入 Passport 地址和 Admin 应用的 `client_id`：

```bash
cd frontend/admin
npm ci
VITE_API_BASE=/api \
VITE_PASSPORT_URL=https://passport.gooyoit.com \
VITE_CLIENT_ID=<ADMIN_CLIENT_ID> \
npm run build
```

## 服务器目录

```text
/data/apps/gooyoit-passport/frontend/current       # Login 前端当前版本
/data/apps/gooyoit-passport/backend                # Login 后端
/data/apps/gooyoit-passport-admin/frontend/current # Admin 前端当前版本
/data/apps/gooyoit-passport-admin/backend          # Admin 后端
```

上传前端产物：

```bash
rsync -az --delete frontend/login/dist/ root@119.23.238.217:/data/apps/gooyoit-passport/frontend/current/
rsync -az --delete frontend/admin/dist/ root@119.23.238.217:/data/apps/gooyoit-passport-admin/frontend/current/
```

## Nginx

仓库配置文件：`deploy/nginx/passport.conf`。

```bash
sudo cp deploy/nginx/passport.conf /etc/nginx/sites-available/passport.gooyoit.com
sudo ln -sfn /etc/nginx/sites-available/passport.gooyoit.com \
  /etc/nginx/sites-enabled/passport.gooyoit.com
sudo nginx -t
sudo systemctl reload nginx
```

Nginx 使用现有通配符证书：

```text
/etc/nginx/ssl/gooyoit.com.pem
/etc/nginx/ssl/gooyoit.com.key
```

## DNS 与防火墙

以下记录应解析到 `119.23.238.217`：

| 类型 | 主机记录 | 记录值 |
|---|---|---|
| A | passport | 119.23.238.217 |
| A | passport-admin | 119.23.238.217 |

Passport 只需要对公网开放 `80`、`443`。不要开放后端的 `8080`、`8081`。服务器上的其他应用仍使用 `8443`，因此 Passport 会在该端口对旧 API 域名明确返回 `410 Gone`，防止请求误入其他站点。

## 后端服务

仓库中的 systemd 单元位于 `deploy/systemd/`，后端只监听回环地址，公网统一通过 Nginx 访问：

```bash
sudo cp deploy/systemd/passport-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart passport-login passport-admin
```

```bash
sudo systemctl status passport-login passport-admin
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8081/openapi.json
```

Login 生产环境至少应配置：

```env
DEBUG=false
COOKIE_SECURE=true
FRONTEND_ORIGINS=["https://passport.gooyoit.com","https://passport-admin.gooyoit.com"]
WEBAUTHN_RP_ID=passport.gooyoit.com
WEBAUTHN_RP_ORIGIN=https://passport.gooyoit.com
```

Admin 生产环境至少应配置：

```env
DEBUG=false
PASSPORT_API_URL=http://127.0.0.1:8080
CORS_ORIGINS=["https://passport-admin.gooyoit.com"]
```

修改环境变量后执行：

```bash
sudo systemctl restart passport-login passport-admin
```

## 验证

```bash
curl -I https://passport.gooyoit.com/
curl https://passport.gooyoit.com/healthz
curl -I https://passport-admin.gooyoit.com/
curl -i -X POST https://passport-admin.gooyoit.com/api/token-refresh
```

浏览器验证：

- `https://passport.gooyoit.com`
- `https://passport-admin.gooyoit.com`

## 更新前端

重新构建后，仅同步两个 `dist` 目录并 reload Nginx。静态资源文件名带内容哈希，`index.html` 使用 `no-store`，发布后会立即读取新入口文件。
