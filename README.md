# Term Gateway MVP

一个按 `PLAN.md` 实现的第一版只读 Web PTY 观察网关。当前版本专注于本地可运行、可持久化、可通过 one-time token 首次进入，再换成 cookie 继续访问。

## 当前能力

- Node.js / TypeScript 服务骨架
- 本地文件 session registry
- `create/list/get/close` 基础 API
- `GET /open/:id/:token` one-time token -> cookie 入口
- `GET /s/:id` 只读 terminal 页面占位
- `GET /api/sessions/:id/stream` ttyd 接入 stub

## 明确未实现

- Cloudflare Access
- 自动 TTL / 自动清理
- 自动关闭 tmux / ttyd
- 数据库
- 网页输入控制
- 真实 ttyd 反代

## 环境要求

- Node.js 24+
- npm 11+

## 配置

复制 `.env.example` 到 `.env`：

```bash
cp .env.example .env
```

环境变量：

```env
HOST=127.0.0.1
PORT=4317
PUBLIC_BASE_URL=http://127.0.0.1:4317
SESSION_SECRET=change-me
REGISTRY_DIR=./data/sessions
COOKIE_NAME=term_gateway_session
COOKIE_SECURE=false
```

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

## 数据落盘

session registry 保存在：

```text
data/
  sessions/
    <terminal_session_id>.json
```

服务会自动创建目录。

## API

### `POST /api/sessions`

创建会话记录。

请求体示例：

```json
{
  "taskName": "codex-rbac-fix",
  "agent": "codex",
  "tmuxSession": "codex-rbac-fix",
  "ttyd": {
    "enabled": false,
    "port": 7681,
    "upstreamUrl": "http://127.0.0.1:7681"
  }
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
    "ttyd": {
      "enabled": false,
      "port": 7681,
      "upstreamUrl": "http://127.0.0.1:7681"
    },
    "createdAt": "2026-03-25T09:00:00.000Z",
    "updatedAt": "2026-03-25T09:00:00.000Z",
    "lastAccessAt": null,
    "publicPath": "/s/opaque_random_id",
    "openToken": {
      "expiresAt": null,
      "consumedAt": null
    }
  },
  "openUrl": "http://127.0.0.1:4317/open/opaque_random_id/<token>"
}
```

### `GET /api/sessions`

列出当前 registry 中的所有会话。

### `GET /api/sessions/:id`

获取单个会话详情。

### `POST /api/sessions/:id/close`

手动将会话标记为 `closed`。MVP 仅更新 registry，不会实际关闭 tmux / ttyd。

### `GET /open/:id/:token`

校验 one-time token，成功后：

- 标记 token 已消费
- 写入签名 cookie
- 302 跳转到 `/s/:id`

### `GET /s/:id`

只读 terminal 页面占位。必须先通过 `/open/:id/:token` 写 cookie 才能访问。

### `GET /api/sessions/:id/stream`

ttyd 接入 stub。当前返回 `501 Not Implemented`，用于保留未来接反代的位置。

## 手工验证示例

创建会话：

```bash
curl -sS -X POST http://127.0.0.1:4317/api/sessions \
  -H 'content-type: application/json' \
  -d '{"taskName":"demo","agent":"codex","tmuxSession":"demo"}'
```

拿到返回里的 `openUrl` 后，用浏览器打开，或：

```bash
curl -i <openUrl>
```

然后带 cookie 访问：

```bash
curl -i http://127.0.0.1:4317/s/<session_id> \
  -H 'Cookie: term_gateway_session=<cookie-value>'
```

## 后续建议

- 把 `/api/sessions/:id/stream` 换成真实 ttyd 代理
- 接入 Cloudflare Tunnel / 独立域名
- 增加人工确认后的真实关闭能力
