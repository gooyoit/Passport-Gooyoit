# Passport 统一认证与权限系统规格说明书 v0.3

## 1. 概述

Passport 是 Gooyoit 内部统一认证与权限中心，用于承接多个独立业务系统的登录、SSO 登录态、用户管理、第三方登录、邮箱验证码登录、系统接入管理和角色权限管理。

系统目标：

- 所有业务系统接入同一个 Passport 登录入口。
- Passport 负责认证、授权基础数据和 SSO 登录态。
- 业务系统负责自己的业务功能、业务数据和本地会话。
- 每个接入系统拥有独立的 `client_id` 和 `client_secret`。
- 每个接入系统可独立配置允许的登录方式。
- 每个接入系统可独立配置角色、权限和用户授权。
- 支持公共用户池与系统私有用户池。
- 支持共享 SSO 登录态：用户在一个系统登录后，可无感访问其他启用公共用户池和 SSO 的系统。

## 2. 技术栈

默认技术栈：

- 后端语言：Python 3.12+
- Web 框架：FastAPI
- ORM：SQLAlchemy 2.x
- 数据验证：Pydantic v2
- 数据库：MySQL 8.x
- 数据库迁移：Alembic
- 缓存与会话：Redis
- Token：JWT + 服务端 Session 混合方案
- OAuth 接入：Authlib
- RBAC 授权引擎：PyCasbin，使用 domain 区分不同接入系统
- 邮件发送：SMTP 或第三方邮件服务
- 代码风格：Google Python Style Guide
- API 文档：OpenAPI / Swagger，由 FastAPI 自动生成

## 3. 核心角色

### 3.1 Passport 平台管理员

平台管理员负责管理 Passport 全局能力：

- 接入系统创建、编辑、禁用。
- 系统密钥生成与轮换。
- 登录方式配置。
- 公共用户管理。
- 全局审计日志查看。
- SSO Session 管理。

### 3.2 接入系统管理员

接入系统管理员负责管理自己系统内的授权数据：

- 本系统用户管理。
- 本系统角色管理。
- 本系统权限管理。
- 本系统用户角色分配。
- 本系统登录方式开关。

### 3.3 普通用户

普通用户能力：

- 可通过接入系统启用的登录方式登录。
- 可绑定多个身份来源，例如邮箱、微信、Google、GitHub。
- 可在不同接入系统中拥有不同角色。

普通用户默认角色规则：

- 普通用户不需要在注册或首次登录时写入 `user_roles` 默认角色绑定记录。
- 每个接入系统必须配置一个默认角色，例如“普通用户”。
- 用户加入或登录某个系统后，如果没有显式角色授权，则自动继承该系统默认角色。
- `user_roles` 只保存管理员、运营、审核员等显式角色分配。
- 最终角色 = 系统默认角色 + 用户显式分配角色。
- 最终权限 = 所有最终角色绑定权限的并集。

该策略避免公共用户池场景下为大量用户和大量系统生成冗余的“普通用户”角色绑定数据。

## 4. 系统模块

### 4.1 认证中心

认证中心负责：

- 统一登录页面。
- 邮箱验证码登录。
- 微信登录。
- Google 登录。
- GitHub 登录。
- 第三方账号绑定。
- 登录态创建、刷新、注销。
- SSO 检查与跳转。

登录方式由接入系统配置控制。用户访问某个业务系统时，业务系统跳转到：

```text
/oauth/authorize?client_id=xxx&redirect_uri=xxx&response_type=code&state=xxx
```

Passport 根据 `client_id` 加载该系统允许的登录方式，并展示对应登录入口。

### 4.2 接入系统管理

每个接入系统注册后生成或配置：

- `client_id`
- `client_secret`
- 系统名称
- 回调地址白名单
- 是否启用公共用户池
- 是否启用 SSO
- 支持的登录方式
- 默认角色
- Token 有效期配置
- 状态：启用 / 禁用

业务系统必须使用 `client_id + client_secret` 调用服务端接口换取或校验用户身份。`client_secret` 不允许出现在前端代码、浏览器请求或移动端公开包中。

### 4.3 用户管理

用户模型分为三层：

- 全局用户：Passport 下的基础用户身份。
- 身份来源：邮箱、微信、Google、GitHub 等登录身份。
- 系统用户关系：用户在某个接入系统内的状态、加入时间、禁用状态和显式角色。

公共用户池规则：

- 若系统启用公共用户池，任何已注册全局用户都可登录该系统。
- 若系统不启用公共用户池，用户必须被该系统显式创建、邀请或授权后才能登录。
- 用户在不同系统中的角色和权限互相隔离。
- 用户首次成功进入某个系统时，创建 `application_users` 关系记录。
- 不因为默认普通用户角色创建 `user_roles` 记录。

### 4.4 权限管理

权限模型采用 RBAC，并使用 PyCasbin 作为轻量授权判定引擎：

- 每个系统独立维护角色。
- 每个角色绑定多个权限。
- 每个系统必须有一个默认角色。
- 用户可拥有零个或多个显式角色。
- 默认角色始终参与权限计算。
- 显式角色用于增加用户权限。
- 使用 Casbin domain 表达系统隔离，`application_id` 作为 domain。
- MySQL 中的角色、权限、角色权限、用户显式角色表是管理后台和审计的事实来源。
- PyCasbin Enforcer 负责运行时权限判定，避免自研权限匹配器。

权限建议使用字符串标识，例如：

```text
user.read
user.create
order.approve
admin.manage
```

Passport 提供权限查询接口，业务系统可在服务端校验用户是否拥有某权限。

第一版只启用 Casbin RBAC 能力，不启用 ABAC、复杂条件表达式或策略脚本。

### 4.5 SSO 登录态

Passport 使用 Passport 域名下的 HttpOnly Secure Cookie 保存 SSO Session。

默认流程：

1. 用户访问业务系统。
2. 业务系统发现未登录，跳转 Passport。
3. Passport 检查是否存在有效 SSO Session。
4. 如果存在，直接签发授权码并跳回业务系统。
5. 如果不存在，展示统一登录页。
6. 用户完成登录后，Passport 创建或刷新 SSO Session。
7. Passport 签发授权码并跳回业务系统。
8. 业务系统用授权码换取 Token。
9. 业务系统建立自己的本地登录态。

SSO 只负责身份认证，不直接替代业务系统自己的会话。

## 5. 标准认证流程

系统采用 OAuth2 Authorization Code 风格的内部协议。

### 5.1 登录跳转

业务系统跳转到：

```http
GET /oauth/authorize
```

参数：

- `client_id`：接入系统 ID。
- `redirect_uri`：登录完成后的回调地址，必须命中白名单。
- `response_type`：固定为 `code`。
- `state`：业务系统生成的随机字符串，用于防 CSRF 和恢复跳转状态。
- `scope`：申请的授权范围，第一版可选。

### 5.2 授权码换 Token

业务系统服务端请求：

```http
POST /oauth/token
```

参数：

- `client_id`
- `client_secret`
- `code`
- `redirect_uri`

返回：

- `access_token`
- `refresh_token`
- `expires_in`
- `user`
- `roles`
- `permissions`

授权码规则：

- 授权码只能使用一次。
- 授权码默认有效期为 5 分钟。
- 授权码必须绑定 `client_id`、`redirect_uri` 和用户。

### 5.3 用户信息接口

```http
GET /oauth/userinfo
```

返回当前用户在指定系统下的身份、角色、权限。

角色返回规则：

- 必须包含系统默认角色。
- 必须包含用户显式分配角色。
- 不要求默认角色存在于 `user_roles` 表。

### 5.4 退出登录

支持两种退出：

- 退出当前业务系统：只清理业务系统本地登录态。
- 全局退出：清理 Passport SSO Session，并通知或引导各业务系统清理本地登录态。

## 6. 数据模型

### 6.1 `users`

全局用户表。

核心字段：

- `id`
- `email`
- `display_name`
- `avatar_url`
- `status`
- `created_at`
- `updated_at`

约束：

- 公共用户池中的邮箱全局唯一。

### 6.2 `user_identities`

第三方身份绑定表。

核心字段：

- `id`
- `user_id`
- `provider`
- `provider_user_id`
- `provider_email`
- `raw_profile`
- `created_at`
- `updated_at`

约束：

- 同一 `provider + provider_user_id` 全局唯一。

### 6.3 `applications`

接入系统表。

核心字段：

- `id`
- `client_id`
- `client_secret_hash`
- `name`
- `description`
- `redirect_uris`
- `default_role_id`
- `enable_public_users`
- `enable_sso`
- `access_token_ttl_seconds`
- `refresh_token_ttl_seconds`
- `status`
- `created_at`
- `updated_at`

约束：

- `client_id` 全局唯一。
- `client_secret` 必须哈希或加密存储，不保存明文。
- `default_role_id` 必须指向同一应用下的有效角色。

### 6.4 `application_login_methods`

系统登录方式配置表。

核心字段：

- `id`
- `application_id`
- `method`
- `enabled`
- `config`
- `created_at`
- `updated_at`

可选登录方式：

- `email_code`
- `wechat`
- `google`
- `github`

### 6.5 `application_users`

用户与系统关系表。

核心字段：

- `id`
- `application_id`
- `user_id`
- `status`
- `joined_at`
- `last_login_at`
- `created_at`
- `updated_at`

用途：

- 表示用户已经加入或访问过某个系统。
- 表示用户在该系统是否被禁用。
- 不表示默认角色绑定。

约束：

- 同一 `application_id + user_id` 唯一。

### 6.6 `roles`

系统角色表。

核心字段：

- `id`
- `application_id`
- `code`
- `name`
- `description`
- `is_default`
- `created_at`
- `updated_at`

约束：

- 同一系统下 `code` 唯一。
- 每个系统必须且只能有一个默认角色。
- 默认角色建议使用 `member` 或 `user` 作为 `code`。

### 6.7 `permissions`

系统权限表。

核心字段：

- `id`
- `application_id`
- `code`
- `name`
- `description`
- `created_at`
- `updated_at`

约束：

- 同一系统下 `code` 唯一。

### 6.8 `role_permissions`

角色权限关系表。

核心字段：

- `id`
- `role_id`
- `permission_id`
- `created_at`

约束：

- 同一 `role_id + permission_id` 唯一。

### 6.9 `user_roles`

用户显式角色关系表。

核心字段：

- `id`
- `application_id`
- `user_id`
- `role_id`
- `created_at`
- `created_by`

用途：

- 只保存显式分配角色。
- 不保存系统默认角色绑定。
- 管理员、运营、审核员等角色通过该表授权。

约束：

- 同一 `application_id + user_id + role_id` 唯一。
- `role_id` 必须属于同一 `application_id`。

### 6.10 `oauth_authorization_codes`

授权码表。

核心字段：

- `id`
- `code`
- `application_id`
- `user_id`
- `redirect_uri`
- `scope`
- `expires_at`
- `used_at`
- `created_at`

约束：

- `code` 全局唯一。
- 授权码一次性使用。

### 6.11 `oauth_tokens`

Token 表，可只保存 refresh token 和撤销状态。

核心字段：

- `id`
- `application_id`
- `user_id`
- `refresh_token_hash`
- `expires_at`
- `revoked_at`
- `created_at`

### 6.12 `sso_sessions`

SSO 会话表。

核心字段：

- `id`
- `session_id`
- `user_id`
- `expires_at`
- `revoked_at`
- `created_at`
- `updated_at`

约束：

- `session_id` 必须随机生成并哈希存储或不可预测。

### 6.13 `email_verification_codes`

邮箱验证码表。

核心字段：

- `id`
- `email`
- `code_hash`
- `purpose`
- `expires_at`
- `used_at`
- `created_at`

约束：

- 验证码不保存明文。
- 验证码一次性使用。

### 6.14 `audit_logs`

审计日志表。

核心字段：

- `id`
- `actor_user_id`
- `application_id`
- `action`
- `target_type`
- `target_id`
- `ip_address`
- `user_agent`
- `metadata`
- `created_at`

## 7. 权限计算规则

给定 `application_id` 和 `user_id`，Passport 按以下步骤计算最终角色：

1. 查询应用默认角色 `applications.default_role_id`。
2. 查询用户在该应用下的显式角色 `user_roles`。
3. 合并默认角色和显式角色并去重。
4. 校验用户和应用状态。
5. 返回最终角色列表。

权限判定使用 PyCasbin：

- Casbin domain：`application_id`。
- Casbin subject：角色编码，例如 `member`、`admin`。
- Casbin object：权限编码，例如 `user.read`。
- Casbin action：第一版固定为 `allow`，业务权限粒度由权限编码表达。
- 角色权限关系由 `roles`、`permissions`、`role_permissions` 转换为 Casbin policy。
- 用户最终角色由默认角色和 `user_roles` 显式角色合并得到，不为默认角色生成用户分组策略。
- 权限查询接口通过最终角色逐个调用 Casbin Enforcer，返回命中的权限并集。

规则：

- 默认角色始终生效。
- 显式角色不覆盖默认角色，只增加权限。
- 用户被系统禁用时，不返回可用权限，并拒绝登录或 Token 换取。
- 应用被禁用时，拒绝所有登录、换 Token 和用户信息查询。
- Casbin policy 可从 MySQL 权限表加载并缓存到 Redis 或进程内存。
- 角色、权限、角色权限变更后，必须刷新对应应用的 Casbin policy 缓存。

## 8. 安全要求

- 所有生产接口必须使用 HTTPS。
- Cookie 使用 `HttpOnly`、`Secure`、`SameSite=Lax` 或更严格配置。
- 授权码一次性使用，默认有效期 5 分钟。
- 邮箱验证码一次性使用，默认有效期 10 分钟。
- 登录、验证码、Token 接口必须限流。
- `redirect_uri` 必须校验白名单。
- 管理后台接口必须有管理员权限校验。
- 敏感操作必须写入审计日志。
- `client_secret` 泄露后支持轮换。
- 第三方 OAuth 回调必须校验 `state` 防 CSRF。
- JWT 使用非对称签名或集中密钥管理。
- `client_secret`、验证码、refresh token 不保存明文。

## 9. 管理后台

Passport 管理后台至少包含：

- 接入系统列表、新增、编辑、禁用。
- 系统密钥生成与轮换。
- 登录方式配置。
- 默认角色配置。
- 公共用户管理。
- 系统用户管理。
- 角色管理。
- 权限管理。
- 用户显式角色分配。
- 登录记录与审计日志。
- SSO Session 管理。

用户角色分配页面必须明确区分：

- 系统默认角色：所有用户自动拥有，不产生 `user_roles` 数据。
- 显式分配角色：写入 `user_roles`，用于增加权限。

## 10. API 边界

Passport 负责：

- 用户身份认证。
- 第三方登录。
- 邮箱验证码。
- SSO Session。
- Token 签发与校验。
- 角色权限查询。
- 接入系统配置管理。

业务系统负责：

- 自己的业务数据。
- 自己的页面权限展示。
- 自己的本地 Session。
- 调用 Passport 校验用户身份和权限。
- 根据权限决定业务操作是否允许。

## 11. 默认策略

默认配置：

- Access Token 有效期：2 小时。
- Refresh Token 有效期：30 天。
- SSO Session 有效期：7 天。
- 邮箱验证码有效期：10 分钟。
- 授权码有效期：5 分钟。
- 新系统默认角色：普通用户。
- 默认启用公共用户池：否，由系统创建时配置。
- 默认启用 SSO：是，但只有公共用户池系统之间共享无感登录。
- 默认角色始终参与权限计算。
- 默认角色不写入 `user_roles`。
- RBAC 使用 PyCasbin，不自研权限匹配框架。
- 第一版只使用 RBAC，不引入 ABAC 或复杂策略引擎。

## 12. 测试计划

必须覆盖：

- 邮箱验证码登录成功、失败、过期、重复使用。
- 微信、Google、GitHub 登录回调流程。
- 不同系统登录方式配置隔离。
- 公共用户池开启和关闭时的登录行为。
- SSO 有效、过期、注销后的跳转行为。
- 授权码只能使用一次。
- `redirect_uri` 白名单校验。
- 用户在不同系统下拥有不同显式角色。
- 用户没有显式角色时仍继承系统默认角色。
- 用户有显式角色时，最终权限包含默认角色和显式角色权限并集。
- 默认角色不产生 `user_roles` 冗余数据。
- 权限查询结果按系统隔离。
- PyCasbin policy 刷新后，角色权限变更能立即影响权限查询。
- 不同应用使用相同角色编码或权限编码时，Casbin domain 隔离必须生效。
- 禁用系统后不可继续登录。
- 禁用系统用户后不可继续换取 Token 或查询权限。
- `client_secret` 错误时无法换取 Token。
- 管理后台权限校验。
- 关键操作审计日志写入。

## 13. Roadmap

版本路线图独立维护在 [roadmap.md](roadmap.md)。
