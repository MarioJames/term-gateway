# Term Gateway MVP Plan

## 目标

构建一个第一版 **只读 Web PTY 观察网关**，用于在执行 `codex` / `claude` 等任务时，把 tmux 中的终端内容通过网页暴露给用户查看。

第一版重点：
- **先跑通能力**
- **先只读，不开放网页输入**
- **不做自动生命周期清理**
- **本地持久化当前有哪些 PTY 会话**
- **后续可平滑接入 Cloudflare Tunnel 独立域名**

项目目录：`~/workspace/term-gateway`
预期独立域名：`term.example.com`

---

## 已对齐需求

### 1. 会话与访问模型
- 创建 Web Terminal 时，系统自动生成一个 **opaque terminal_session_id**
- URL 中直接带上这个 session，不让用户手动输入
- 访问时再配合一次性 token 进入
- 第一版先不接 Cloudflare Access
- 第一版先不做自动 TTL / 自动回收

### 2. 交互模型
- 浏览器端默认 **只读**
- 用户如果要输入，不在网页里输
- 用户通过聊天发消息，由主助手转发到 tmux 里执行

### 3. 生命周期模型
- 第一版 **不自动清理**
- 本地维护一个 PTY registry
- 后续按固定周期（例如每小时）由主助手询问：
  - 当前还有哪些 PTY
  - 哪些看起来可以关闭
  - 用户回复后再人工清理

### 4. 安全模型（第一版）
- 先不接 Cloudflare Access
- 但访问仍需要：
  - `terminal_session_id`
  - one-time token
- 推荐模式：
  - 首次访问 `open` 链接带 one-time token
  - gateway 验证后换成 session cookie
  - 后续访问通过 cookie
- 不做长期 query token 直连终端

---

## 第一版范围（MVP In Scope）

### A. 基础服务
实现一个最小 Node.js/TypeScript 服务，负责：
- session registry 管理
- session / token 生成
- API 提供
- token 校验与 cookie 签发
- terminal 页面占位
- 为后续 ttyd 反代留好接口

### B. 本地持久化
使用本地文件存储，不上数据库。
建议结构：

```text
registry/
  sessions/
    <terminal_session_id>.json
```

或者：

```text
data/
  sessions/
    <terminal_session_id>.json
```

### C. 会话数据结构
建议最小字段：

```json
{
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
  "createdAt": "2026-03-25T09:00:00+08:00",
  "updatedAt": "2026-03-25T09:00:00+08:00",
  "lastAccessAt": null,
  "publicPath": "/s/<id>",
  "openToken": {
    "hash": "...",
    "expiresAt": null,
    "consumedAt": null
  }
}
```

### D. 核心 API
第一版至少提供：

- `POST /api/sessions`
  - 创建会话记录
  - 返回 `terminal_session_id` 和首访链接

- `GET /api/sessions`
  - 列出当前 PTY registry

- `GET /api/sessions/:id`
  - 获取单个会话详情

- `POST /api/sessions/:id/close`
  - 手动标记关闭
  - 第一版可以只更新 registry，不强制真的 kill tmux/ttyd

- `GET /open/:id/:token`
  - one-time token 入口
  - 验证成功后换 session cookie，再跳转 `/s/:id`

- `GET /s/:id`
  - 只读 terminal 页面

- `GET /api/sessions/:id/stream` 或占位路由
  - 未来接 ttyd / proxy
  - 第一版允许 stub

### E. 页面
只需要一个简单页面：
- 展示 session 基本信息
- 展示当前状态
- 展示“只读模式”标识
- 如未接 ttyd，可先放占位文案
- 如果 ttyd 已可接入，再嵌入 iframe 或代理视图

### F. 配置
提供 `.env.example`，至少包含：

```env
HOST=127.0.0.1
PORT=4317
PUBLIC_BASE_URL=http://127.0.0.1:4317
SESSION_SECRET=change-me
REGISTRY_DIR=./data/sessions
COOKIE_NAME=term_gateway_session
COOKIE_SECURE=false
```

---

## 第一版明确不做（Out of Scope）

- Cloudflare Access
- 自动 TTL 过期
- 自动清理 tmux / ttyd
- 完整用户体系
- 多人权限模型
- 数据库
- 真正的远程写入控制
- 高级审计系统

---

## 推荐实现顺序

### 第 1 步：项目骨架
- 初始化 Node.js/TypeScript 项目
- 加基础脚本：`dev` / `build` / `start`
- 加 `.env.example`
- 加 README

### 第 2 步：registry
- 实现 session 文件读写
- 实现 create/list/get/close
- 确保数据目录自动创建

### 第 3 步：token + cookie
- 生成 one-time token
- 存 hash，不存明文 token
- 实现 `/open/:id/:token`
- 验证成功后写 cookie，并标记 `consumedAt`

### 第 4 步：只读页面
- `/s/:id` 页面显示会话信息
- 显示“只读，输入请走聊天”提示
- ttyd 先接 stub

### 第 5 步：ttyd 适配层
- 把 ttyd upstream 配置位置留出来
- 第一版可先返回未接入状态
- 第二版再接真正反代

### 第 6 步：实现报告
- 写清已完成项
- 写清 stub 项
- 写清接 Cloudflare Tunnel / ttyd 的下一步

---

## 后续第二阶段

第二阶段再做：
- 接入真实 ttyd 反代
- 接入 Cloudflare Tunnel 独立域名 `term.example.com`
- 增加“每小时提醒用户是否清理 PTY”的调度机制
- 增加真实关闭能力：kill tmux / kill ttyd
- 如果需要，再叠 Cloudflare Access

---

## 当前阻塞与注意事项

### Codex 当前环境问题
这次实施过程中，Codex 在当前会话环境里仍读到了：

```text
```

导致 Codex 请求继续打到 DashScope 的 `/v1/responses`，出现：
- websocket 405
- https 404

因此下一会话开始前，建议优先确认：

---

## 下一会话的开工指令

新会话可以直接按下面目标执行：

1. 进入 `~/workspace/term-gateway`
3. 如果环境干净，则使用 Codex 实现本计划的 MVP
4. 如果环境仍脏，则先征求用户是否允许：
   - 再继续 Codex 实施
5. 实现完成后：
   - 本地验证可运行
   - 写实现报告
   - git commit
   - 不 push

---

## 成功标准

满足以下条件即可认为 MVP 第一版完成：

- 仓库中有清晰 README
- 有可运行的最小 Node.js/TypeScript 服务
- 有 session registry
- 有 create/list/get/close 基础 API
- 有 one-time token -> cookie 的入口骨架
- 有只读 terminal 页面占位
- 有 ttyd 接入占位层
- 有 `.env.example`
- 有实现报告
- 已完成本地构建或最小运行验证
- 已提交 git commit，未 push
