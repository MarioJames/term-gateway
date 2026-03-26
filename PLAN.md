# Term Gateway MVP Plan

## 目标

构建一个第一版 **只读 Web PTY 观察网关**，用于在执行 `codex` / `claude` 等任务时，把 tmux 中的终端内容通过网页暴露给用户查看。

第一版重点：
- **先跑通能力**
- **先只读，不开放网页输入**
- **不做自动生命周期清理**
- **本地持久化当前有哪些 PTY 会话**
- **后续可平滑接入 Cloudflare Tunnel 独立域名**

公开仓库约束：
- 文档和示例配置不写死个人目录、个人域名或供应商环境信息
- 应用关键配置统一收敛到 `.env.example`
- Tunnel / 反向代理示例统一使用通用占位符或 `term.example.com`

---

## 已对齐需求

### 1. 会话与访问模型
- 创建 Web Terminal 时，系统自动生成一个 **opaque terminal_session_id**
- URL 中直接带上这个 session，不让用户手动输入
- 访问时再配合限时有效 token 进入
- 第一版先不接 Cloudflare Access
- 第一版先不做自动 TTL / 自动回收

### 2. 交互模型
- 浏览器端默认 **只读**
- 用户如果要输入，不在网页里输
- 用户通过聊天发消息，由主助手转发到 tmux 里执行

### 3. 生命周期模型
- 第一版 **不自动清理**
- 本地维护一个 PTY session registry
- 后续按固定周期（例如每小时）由主助手询问：
  - 当前还有哪些 PTY
  - 哪些看起来可以关闭
  - 用户回复后再人工清理

### 4. 安全模型（第一版）
- 先不接 Cloudflare Access
- 但访问仍需要：
  - `terminal_session_id`
  - 限时有效 open token
- 推荐模式：
  - 首次访问 `open` 链接带限时 token
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
- terminal 页面渲染
- tmux 文本桥接

### B. 本地持久化
使用 SQLite 文件，不上复杂 ORM。
默认结构：

```text
data/
  term-gateway.sqlite
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
  "createdAt": "2026-03-25T09:00:00+08:00",
  "updatedAt": "2026-03-25T09:00:00+08:00",
  "lastAccessAt": null,
  "publicPath": "/s/<id>",
  "openToken": {
    "hash": "...",
    "expiresAt": "2026-03-25T09:30:00.000Z",
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
  - 列出当前 SQLite registry

- `GET /api/sessions/:id`
  - 获取单个会话详情

- `POST /api/sessions/:id/close`
  - 手动标记关闭
  - 把数据库里的 session 状态更新为 `closed`

- `GET /open/:id/:token`
  - 限时 token 入口
  - 验证成功后换 session cookie，再跳转 `/s/:id`

- `GET /s/:id`
  - 只读 terminal 页面

- `GET /api/sessions/:id/stream`
  - 提供单次 JSON snapshot
  - 支持 SSE 推送 tmux 文本快照

### E. 页面
只需要一个简单页面：
- 展示 session 基本信息
- 展示当前状态
- 展示“只读模式”标识
- 持续展示 tmux pane 文本快照

### F. 配置
提供 `.env.example` 作为主要配置入口，至少包含：

```env
HOST=127.0.0.1
PORT=4317
PUBLIC_BASE_URL=http://127.0.0.1:4317
SESSION_SECRET=change-me
DATABASE_PATH=./data/term-gateway.sqlite
COOKIE_NAME=term_gateway_session
COOKIE_SECURE=false
OPEN_TOKEN_TTL_SECONDS=1800
```

并明确：
- `PUBLIC_BASE_URL` 代表最终对外访问地址
- `COOKIE_SECURE` 随 HTTPS 打开
- Tunnel / 反向代理示例里的 hostname 与回源地址需要与 `.env` 对齐

---

## 第一版明确不做（Out of Scope）

- Cloudflare Access
- 自动 TTL 过期
- 自动清理 tmux
- 完整用户体系
- 多人权限模型
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
- 实现 SQLite session 读写
- 实现 create/list/get/close
- 确保数据库目录与 schema 自动创建

### 第 3 步：token + cookie
- 生成限时 open token
- 存 hash，不存明文 token
- 实现 `/open/:id/:token`
- 验证成功后写 cookie，并校验 `expiresAt`

### 第 4 步：只读页面
- `/s/:id` 页面显示会话信息
- 显示“只读，输入请走聊天”提示
- 通过 SSE 拉取 tmux 文本快照

### 第 5 步：terminal stream bridge
- 读取 tmux 可见 pane 内容
- 提供 JSON / SSE 观察桥接
- 保留只读访问模型

### 第 6 步：实现报告
- 写清已完成项
- 写清剩余限制
- 写清接 Cloudflare Tunnel 的下一步

---

## 后续第二阶段

第二阶段再做：
- 接入 Cloudflare Tunnel 独立域名（使用自有域名）
- 增加“每小时提醒用户是否清理 PTY”的调度机制
- 增加真实关闭能力：kill tmux
- 如果需要，再叠 Cloudflare Access

---

## 文档与开源清洗约束

- README、PLAN、示例配置文件统一使用通用示例值，不保留个人环境痕迹
- `.env.example` 负责承载公开文档里提到的关键应用配置
- `.gitignore` 继续忽略 `.env`、`.env.*`、数据库文件和本地 `cloudflared` 实际配置
- 文档要保留“可落地运行”的说明，避免因为清洗而丢失部署步骤或验证方法

---

## 成功标准

满足以下条件即可认为 MVP 第一版完成：

- 仓库中有清晰 README
- 有可运行的最小 Node.js/TypeScript 服务
- 有 SQLite-backed session registry
- 有 create/list/get/close 基础 API
- 有限时 token -> cookie 的入口
- 有只读 terminal 页面
- 有 tmux 文本桥接
- 有 `.env.example`
- 有实现报告
- 已完成本地构建或最小运行验证
- 已提交 git commit，未 push
