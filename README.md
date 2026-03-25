# Term Gateway MVP

一个按 `PLAN.md` 持续增量实现的只读 Web PTY 观察网关。当前版本已经支持本地持久化、one-time token -> cookie 首访入口，以及在配置了 ttyd upstream 时通过同源代理嵌入真实终端视图。

## 当前能力

- Node.js / TypeScript 服务骨架
- 本地文件 session registry
- `create/list/get/close` 基础 API
- `GET /open/:id/:token` one-time token -> cookie 入口
- `GET /s/:id` 只读 terminal 页面，可嵌入真实 ttyd 视图
- `GET /api/sessions/:id/stream` ttyd HTTP / websocket 同源代理
- `POST /api/sessions/:id/close` 人工触发的真实 tmux / ttyd 关闭
- `ttyd.enabled=false` 或 upstream 未配置时的优雅降级

## 明确未实现

- Cloudflare Access
- 自动 TTL / 自动清理
- 自动关闭 tmux / ttyd
- 数据库
- 网页输入控制
- Cloudflare Tunnel 集成

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
    "enabled": true,
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
      "enabled": true,
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

手动触发关闭，并始终把 registry 状态更新为 `closed`。

- 如果 `tmuxSession` 存在，会尝试执行真实 `tmux kill-session -t <name>`
- 如果 `ttyd.enabled=true`，会尝试识别并停止本机 ttyd 进程
- ttyd 只会在“目标可可靠识别”时才会被杀掉；识别不到时会返回 `unsupported` 或 `not_found`
- 关闭结果会结构化返回，不会因为单项失败把整个请求直接变成 500

结构化结果状态：

- `closed`: 目标已被关闭
- `not_found`: 没找到对应目标
- `unsupported`: 当前条件下无法可靠识别目标，因此拒绝猜测性关闭
- `skipped`: 当前 session 不需要关闭该类资源
- `failed`: 已尝试关闭，但执行失败

ttyd 识别策略当前是保守模式：

- upstream 必须是本机地址（`127.0.0.1` / `localhost` / `::1`）
- 进程名必须能识别为 `ttyd`
- 命令行里必须能匹配到与 session 配置一致的端口参数（如 `-p 7681`）
- 如果出现多个候选进程，则返回 `unsupported`

### `GET /open/:id/:token`

校验 one-time token，成功后：

- 标记 token 已消费
- 写入签名 cookie
- 302 跳转到 `/s/:id`

### `GET /s/:id`

只读 terminal 页面。必须先通过 `/open/:id/:token` 写 cookie 才能访问。

- 如果 `ttyd.enabled=true` 且 `upstreamUrl` 可用，页面会通过同源 iframe 嵌入 `/api/sessions/:id/stream/`
- 如果 ttyd 未启用或 upstream 缺失，页面会降级显示“Terminal unavailable”
- 当前不实现网页写入控制；产品定位仍是只读观察，输入仍应通过聊天转发

### `GET /api/sessions/:id/stream`

真实 ttyd 代理入口。

- `GET /api/sessions/:id/stream` 会重定向到带尾斜杠的 `/api/sessions/:id/stream/`
- `/api/sessions/:id/stream/` 以及其子路径会被代理到 `session.ttyd.upstreamUrl`
- websocket upgrade 也会通过同一路径转发
- 如果 ttyd 未启用或 upstream 缺失，根路径会返回可读的 unavailable 页面，子路径返回未接入提示

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

如果该 session 配置了 ttyd upstream，也可以直接验证代理根路径：

```bash
curl -i http://127.0.0.1:4317/api/sessions/<session_id>/stream/ \
  -H 'Cookie: term_gateway_session=<cookie-value>'
```

## 后续建议

- 接入 Cloudflare Tunnel / 独立域名
- 如果需要真正的只读约束，再单独评估 ttyd / 前端层的输入限制方案
- 如果要让 ttyd close 更可靠，可以在 session 元数据中额外记录受控 pid 或启动元信息
