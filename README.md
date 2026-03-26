# Term Gateway MVP

一个按 `PLAN.md` 持续增量实现的只读 Web PTY 观察网关。当前版本已经支持 SQLite 持久化、限时 open token -> cookie 首访入口，以及由 gateway 自己提供终端观察页面和 tmux 文本桥接。

## 当前能力

- Node.js / TypeScript 服务骨架
- SQLite session / token 持久化
- `create/list/get/close` 基础 API
- `GET /open/:id/:token` 限时 token -> cookie 入口
- `GET /s/:id` 自控只读 terminal 页面
- `GET /api/sessions/:id/stream` gateway 自己提供的 tmux snapshot JSON / SSE 桥接
- `POST /api/sessions/:id/close` 人工触发的真实 tmux 关闭
- 随仓库分发并由应用自托管的 Web 字体，覆盖 Latin / 简体中文 / Nerd Font 常见符号
- Cloudflare Tunnel / 反向代理部署文档与示例配置
- 保留现有 session / open 链接体系，页面入口不变

## 明确未实现

- Cloudflare Access
- 自动 TTL / 自动清理
- 自动关闭 tmux
- 网页输入控制

## 环境要求

- Node.js 24+
- npm 11+

## 配置

应用配置以 `.env.example` 为准。复制到 `.env` 后按需修改：

```bash
cp .env.example .env
```

关键项：

- `HOST` / `PORT`: Node 服务监听地址
- `PUBLIC_BASE_URL`: 用于生成 `openUrl` 的外部访问地址
- `SESSION_SECRET`: 公开部署前必须替换
- `DATABASE_PATH`: SQLite 文件路径
- `COOKIE_NAME` / `COOKIE_SECURE`: 访问 cookie 配置
- `OPEN_TOKEN_TTL_SECONDS`: 首访链接有效期

本地开发通常保留默认值；如果通过 Tunnel 或反向代理暴露公网入口，优先修改 `.env` 里的 `PUBLIC_BASE_URL` 和 `COOKIE_SECURE`。

## Cloudflare Tunnel 部署

如果要通过 Cloudflare Tunnel 暴露公网入口，先把应用侧配置收敛到 `.env`。公开仓库里的示例统一使用通用占位符，例如 `https://term.example.com`。

### 生产环境变量示例

复制 `.env.example` 后，公网部署至少确认这些值：

```env
PUBLIC_BASE_URL=https://term.example.com
SESSION_SECRET=replace-with-a-long-random-secret
COOKIE_SECURE=true
```

关键点：

- `PUBLIC_BASE_URL` 必须使用最终公网地址，例如 `https://term.example.com`
- `COOKIE_SECURE=true`，因为公网访问走 HTTPS
- `HOST` / `PORT` 决定应用实际监听地址；`cloudflared` 需要回源到对应的 `http://HOST:PORT`
- `DATABASE_PATH` 指向 SQLite 文件；服务启动时会自动建库建表
- `OPEN_TOKEN_TTL_SECONDS` 默认 1800 秒，也就是 30 分钟

### 推荐的 cloudflared ingress 片段

官方文档要求 ingress 规则最后带一个 catch-all。当前项目推荐最小配置如下：

```yaml
tunnel: <YOUR_TUNNEL_UUID>
credentials-file: /etc/cloudflared/<YOUR_TUNNEL_UUID>.json

ingress:
  - hostname: <YOUR_PUBLIC_HOSTNAME>
    service: http://<TERM_GATEWAY_HOST>:<TERM_GATEWAY_PORT>
  - service: http_status:404
```

仓库内也提供了示例文件：

```text
cloudflared/config.example.yml
```

### 推荐部署步骤

1. 在 Cloudflare 上创建 tunnel。
2. 把你的公网 hostname 路由到该 tunnel。
3. 在运行 `term-gateway` 的机器上安装 `cloudflared`。
4. 基于 `.env.example` 准备 `.env`，确认 `PUBLIC_BASE_URL`、`HOST`、`PORT`、`SESSION_SECRET`。
5. 启动本地服务：

```bash
npm run build
npm run start
```

6. 准备 `cloudflared` 配置文件，可基于仓库里的示例复制后填入真实 tunnel UUID、hostname 和回源地址。
7. 启动 tunnel：

```bash
cloudflared tunnel run <YOUR_TUNNEL_UUID_OR_NAME>
```

如果你使用本地管理的 tunnel，也可以先显式把 DNS 记录绑定到 tunnel：

```bash
cloudflared tunnel route dns <YOUR_TUNNEL_UUID_OR_NAME> <YOUR_PUBLIC_HOSTNAME>
```

### 生产建议

- `term-gateway` 和 `cloudflared` 部署在同一台机器上时，`service` 直接写 `http://HOST:PORT`
- 如果 `cloudflared` 与 `term-gateway` 不在同机，`service` 改成 `term-gateway` 实际可达的内网地址
- 先确认部署机上的 `http://HOST:PORT` 可用，再启动 tunnel，避免把 tunnel 层问题和应用层问题混在一起
- 当前项目尚未接入 Cloudflare Access；如果未来要加登录保护，应在 tunnel 可用后再单独叠加

## 运行

安装依赖：

```bash
npm install
```

开发模式：

```bash
npm run dev
```

构建：

```bash
npm run build
```

运行构建产物：

```bash
npm run start
```

## Bundled Fonts

为避免依赖访问者本机字体，当前版本会通过 `GET /assets/*` 自托管字体资源，并在 gateway 自己的终端页面中优先使用同一套字体栈：

- `Sarasa Term SC Nerd`：终端内统一使用的等宽中英文 + Nerd glyph 字体，减少混合字体渲染偏差

字体文件位于：

```text
assets/fonts/
```

## 数据落盘

SQLite 数据库默认保存在：

```text
data/term-gateway.sqlite
```

服务会自动创建数据库目录和基础 schema。

## API

### `POST /api/sessions`

创建会话记录。

请求体示例：

```json
{
  "taskName": "codex-rbac-fix",
  "agent": "codex",
  "tmuxSession": "codex-rbac-fix"
}
```

响应示例：

```json
{
  "session": {
    "id": "opaque_random_id",
    "taskName": "codex-rbac-fix",
    "agent": "codex",
    "mode": "readonly",
    "status": "running",
    "tmuxSession": "codex-rbac-fix",
    "createdAt": "2026-03-25T09:00:00.000Z",
    "updatedAt": "2026-03-25T09:00:00.000Z",
    "lastAccessAt": null,
    "publicPath": "/s/opaque_random_id",
    "openToken": {
      "expiresAt": "2026-03-25T09:30:00.000Z",
      "consumedAt": null
    }
  },
  "openUrl": "https://term.example.com/open/opaque_random_id/<token>"
}
```

### `GET /api/sessions`

列出当前数据库中的所有会话。

### `GET /api/sessions/:id`

获取单个会话详情。

### `POST /api/sessions/:id/close`

手动触发关闭，并始终把数据库中的 session 状态更新为 `closed`。

- 如果 `tmuxSession` 存在，会尝试执行真实 `tmux kill-session -t <name>`
- 关闭结果会结构化返回，不会因为单项失败把整个请求直接变成 500

结构化结果状态：

- `closed`: 目标已被关闭
- `not_found`: 没找到对应目标
- `unsupported`: 当前主机不支持执行关闭动作
- `skipped`: 当前 session 不需要关闭该类资源
- `failed`: 已尝试关闭，但执行失败

### `GET /open/:id/:token`

校验限时 token。满足以下条件时成功：

- token hash 正确
- 当前时间未超过 `openToken.expiresAt`
- 写入签名 cookie
- 302 跳转到 `/s/:id`

默认 TTL 为 1800 秒，也就是 30 分钟，可通过 `OPEN_TOKEN_TTL_SECONDS` 配置。

### `GET /s/:id`

极简全屏 terminal 页面。必须先通过 `/open/:id/:token` 写 cookie 才能访问。

- 页面由 term-gateway 自己渲染
- 页面会通过 `EventSource` 连接 `/api/sessions/:id/stream`，持续接收 tmux 文本快照
- 浏览器内当前只读，不提供网页输入控制
- 页面会优先使用仓库内置字体，不依赖访问者本机 Nerd Font 或中文字体
- 当前目标是优先稳定显示中英文与 box-drawing 字符，而不是完整终端协议仿真

### `GET /api/sessions/:id/stream`

gateway 自己提供的终端观察桥接入口。

- `Accept: text/event-stream` 时返回 SSE，供 `/s/:id` 页面持续接收 tmux 快照
- 其他普通 `GET` 请求返回单次 JSON snapshot，便于调试和手测
- 当前 bridge 直接读取 `tmuxSession` 的可见 pane 内容

## 手工验证示例

如果你已经在 shell 里导出了与 `.env` 一致的值，可以直接复用：

```bash
BASE_URL="${PUBLIC_BASE_URL:-http://127.0.0.1:${PORT:-4317}}"
COOKIE_NAME="${COOKIE_NAME:-term_gateway_session}"
```

创建会话：

```bash
curl -sS -X POST "$BASE_URL/api/sessions" \
  -H 'content-type: application/json' \
  -d '{"taskName":"demo","agent":"codex","tmuxSession":"demo"}'
```

拿到返回里的 `openUrl` 后，用浏览器打开，或：

```bash
curl -i <openUrl>
```

然后带 cookie 访问：

```bash
curl -i "$BASE_URL/s/<session_id>" \
  -H "Cookie: $COOKIE_NAME=<cookie-value>"
```

也可以直接验证单次 snapshot：

```bash
curl -sS "$BASE_URL/api/sessions/<session_id>/stream" \
  -H "Cookie: $COOKIE_NAME=<cookie-value>"
```

验证 SSE：

```bash
curl -N "$BASE_URL/api/sessions/<session_id>/stream" \
  -H "Accept: text/event-stream" \
  -H "Cookie: $COOKIE_NAME=<cookie-value>"
```

## 迁移说明

- `/open/:id/:token` 和 `/s/:id` 保持不变，现有对外分享链接体系不需要改
- `/api/sessions/:id/stream` 现在是 gateway 自己的 JSON / SSE 终端桥接
- 服务启动时会自动把旧版 `sessions` 表迁移为当前 schema，移除废弃的终端代理字段

## 后续建议

- 接入你自己的 Cloudflare Tunnel / 独立域名
- 如果要支持颜色、光标和更完整的终端语义，再单独评估自控前端渲染方案
