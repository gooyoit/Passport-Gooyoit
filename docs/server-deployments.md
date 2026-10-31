# 服务器站点与部署目录

服务器：`119.23.238.217`

统一规则：所有应用代码、静态文件、release 和 Docker 部署快照位于 `/data/apps/<system-name>`。Nginx 与 systemd 只引用规范目录，不保留旧目录软链接。

## Nginx 站点

| 站点/入口 | 用途 | 部署目录或上游 |
|---|---|---|
| `passport.gooyoit.com` | Passport 登录页与 Login API | 前端 `/data/apps/gooyoit-passport/frontend/current`；后端 `/data/apps/gooyoit-passport/backend`，端口 `127.0.0.1:8080` |
| `passport-admin.gooyoit.com` | Passport 管理台与 Admin API | 前端 `/data/apps/gooyoit-passport-admin/frontend/current`；后端 `/data/apps/gooyoit-passport-admin/backend`，端口 `127.0.0.1:8081` |
| `ai.gooyoit.com`, `www.gooyoit.com` | Gooyoit Portal（同一站点；`www` 待 DNS 生效） | `/data/apps/gooyoit-portal/current`，端口 `127.0.0.1:18765` |
| `airadar.gooyoit.com` | Airadar / LeadGen | `/data/apps/ai-leadgen-platform`；前端在 `current/frontend/web/dist`，API 在 `current/backend/leadgen`，端口 `8000` |
| `wechat-marketing.gooyoit.com` | 微信营销平台 | `/data/apps/wechat-marketing-platform`；Web 端口 `3200`，API 端口 `127.0.0.1:8200` |
| `rsshub.gooyoit.com:8443` | RSSHub | Docker 容器 `rsshub`，部署快照 `/data/apps/rsshub`，端口 `1200` |
| `ocr.gooyoit.com:8443` | Paddle OCR | Docker 容器 `paddle-ocr`，构建源 `/data/apps/learnica/paddle-ocr`，端口 `127.0.0.1:8100` |

## 无 Nginx 站点的应用

| 系统 | 运行方式 | 部署目录 |
|---|---|---|
| Learnica PDF Worker | Docker `learnica-pdf-worker`，端口 `8091` | `/data/apps/learnica-pdf-worker` |
| Browserless | Docker `browserless`，端口 `4000` | `/data/apps/browserless` |
| WeChat Transfer | 当前无 systemd/Nginx 服务 | `/data/apps/wechat-transfer` |

## 已下线

| 系统 | 状态 |
|---|---|
| `healthy-meals-plan` | systemd 和 Nginx 配置已停用并移出生产配置 |
| `ai-family-health` | backend/OCR 服务和 Nginx 站点已停用，应用文件位于迁移隔离备份中 |

迁移配置备份：`/data/apps/_migration-backups/20261030215843`、`/data/apps/_migration-backups/20261030223000`。
