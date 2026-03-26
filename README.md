# term-gateway

`term-gateway` 是一个面向 `tmux` 会话的只读 Web 观察网关。它把本机或服务器上的终端会话登记到 SQLite 中，通过限时 `open` 链接换取签名 cookie，再把 `tmux` 当前可见内容以网页和 SSE 的方式暴露给浏览器查看。

当前仓库处于 MVP 阶段，重点是先把“可分享、可查看、只读”的路径跑通，而不是做完整的远程终端托管平台。

## 解决什么问题

这个项目适合下面几类场景：

- 把长时间运行的 `codex`、`claude` 或其他命令行任务通过网页分享给旁观者查看
- 给已有的 `tmux` 会话补一个轻量的浏览器观察入口，而不是直接开放 SSH 或交互式终端
- 在 Cloudflare Tunnel 或其他反向代理之后，给远程用户提供一个只读的会话查看页

它当前不试图解决浏览器输入、多人权限、完整终端仿真或自动资源回收。

## 核心特性

- SQLite 持久化的 session registry，支持创建、列出、查询和关闭会话
- `opaque session id + 限时 open token + 签名 cookie` 的访问链路
- 网关自己渲染只读终端页面，不依赖仓库内的前端框架
- 从 `tmux capture-pane` 读取文本快照，并通过 JSON / SSE 暴露给浏览器
- 读取 pane 尺寸信息，并在 alternate screen 不可用时自动回退到普通 capture
- `POST /api/sessions/:id/close` 会尝试执行真实的 `tmux kill-session`，并返回结构化关闭结果
- 自托管字体与静态资源，覆盖终端页面常见的英文字体、简体中文和 Nerd Font 符号显示
- 提供 `cloudflared` 示例配置，便于接到 Cloudflare Tunnel 或其他反向代理后使用
- 启动时会检查并迁移旧版 `sessions` 表中遗留的 `ttyd_*` 字段

## 当前限制

- 浏览器端只读，没有网页输入能力
- 没有接入 Cloudflare Access、SSO 或完整用户体系
- 没有自动 TTL 清理、自动关闭 `tmux`、后台任务调度
- 终端内容来自 `tmux` 文本快照，不是完整终端协议仿真
- 仓库里没有 Dockerfile、CI/CD 工作流、npm 发布配置或正式发行流程

## 技术栈

- Node.js 24+
- TypeScript 5
- Node 内置模块：`node:http`、`node:sqlite`、`node:crypto`、`node:child_process`
- `tmux`
- Server-Sent Events (`EventSource`)
- 自托管字体资源
- Cloudflare Tunnel 示例配置（可选）

## 项目结构

```text
.
├── src/
│   ├── server.ts          # HTTP 服务入口与路由
│   ├── registry.ts        # SQLite session 持久化与迁移
│   ├── auth.ts            # token hash、cookie 签名与校验
│   ├── terminalStream.ts  # tmux 快照读取与 SSE/JSON 桥接
│   ├── closeSession.ts    # 关闭 tmux session
│   ├── html.ts            # 只读页面 HTML 输出
│   ├── fonts.ts           # 终端字体配置
│   └── *.ts               # 其他类型与辅助模块
├── assets/fonts/          # 自托管字体与字体许可证
├── cloudflared/           # Tunnel 示例配置
├── data/                  # 默认 SQLite 数据目录
├── dist/                  # TypeScript 构建产物
├── .env.example           # 环境变量样例
└── PLAN.md                # 当前 MVP 目标与边界说明
```

## 快速开始

### 前置要求

- Node.js `>=24`
- npm
- `tmux`

如果宿主机没有 `tmux`，服务仍能启动，但终端快照与关闭能力会返回 `unsupported` / `unavailable` 状态。

### 1. 安装依赖并准备配置

```bash
npm install
cp .env.example .env
```

默认配置会让服务监听在 `http://127.0.0.1:4317`。

### 2. 准备一个 tmux 会话

例如创建一个名为 `demo` 的后台会话：

```bash
tmux new-session -d -s demo
```

### 3. 启动服务

开发模式：

```bash
npm run dev
```

或先构建再启动：

```bash
npm run build
npm run start
```

### 4. 创建一个可观察会话

```bash
curl -sS -X POST http://127.0.0.1:4317/api/sessions \
  -H 'content-type: application/json' \
  -d '{"taskName":"demo","agent":"codex","tmuxSession":"demo"}'
```

返回值里会包含：

- `session`：当前会话元数据
- `openUrl`：限时访问链接，例如 `http://127.0.0.1:4317/open/<id>/<token>`

用浏览器打开 `openUrl` 后，网关会写入签名 cookie 并跳转到 `/s/:id`。

## 安装与运行

### 可用脚本

- `npm run dev`
  使用 Node 24 的 `--experimental-strip-types --watch` 直接运行 `src/server.ts`
- `npm run build`
  使用 `tsc` 编译到 `dist/`
- `npm run start`
  运行构建产物 `dist/server.js`

### 运行时行为

- 启动时会自动创建数据库目录与 `sessions` 表
- `DATABASE_PATH` 不是 `:memory:` 时会解析成绝对路径
- 默认只绑定到 `127.0.0.1:4317`
- `PUBLIC_BASE_URL` 用于生成返回给调用方的 `openUrl`

## 环境变量

以下配置来自 [.env.example](/Users/wangyahui/workspace/term-gateway/.env.example)：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Node 服务监听地址 |
| `PORT` | `4317` | Node 服务监听端口 |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:4317` | 对外生成 `openUrl` 时使用的外部访问地址 |
| `SESSION_SECRET` | `change-me` | 用于 open token hash 和 session cookie 签名；公开部署前必须替换 |
| `DATABASE_PATH` | `./data/term-gateway.sqlite` | SQLite 文件路径；只有临时测试时才建议使用 `:memory:` |
| `COOKIE_NAME` | `term_gateway_session` | 浏览器访问 session cookie 名称 |
| `COOKIE_SECURE` | `false` | 当 `PUBLIC_BASE_URL` 使用 HTTPS 时应设置为 `true` |
| `OPEN_TOKEN_TTL_SECONDS` | `1800` | `open` 链接有效期，默认 30 分钟 |

额外说明：

- `.env.example` 已明确要求让外部代理的 `hostname` 与 `PUBLIC_BASE_URL` 对齐
- `.env.example` 已明确要求让代理回源地址与 `http://HOST:PORT` 对齐
- 源码还支持通过额外环境变量 `TMUX_BINARY` 指定 `tmux` 可执行文件路径，但这个变量目前没有写入 `.env.example`

## API 概览

### `POST /api/sessions`

创建一个新的只读 session，返回 session 详情和 `openUrl`。

请求体示例：

```json
{
  "taskName": "demo",
  "agent": "codex",
  "tmuxSession": "demo"
}
```

### `GET /api/sessions`

列出所有已登记的 session。

### `GET /api/sessions/:id`

返回单个 session 的详情。

### `POST /api/sessions/:id/close`

把 session 状态标记为 `closed`，并尝试执行 `tmux kill-session -t <name>`。

### `GET /open/:id/:token`

校验限时 token，成功后写入签名 cookie 并 `302` 跳转到 `/s/:id`。

### `GET /s/:id`

只读会话页面。必须先通过 `/open/:id/:token` 获取 cookie。

### `GET /api/sessions/:id/stream`

- 普通 `GET`：返回一次性的 JSON 快照
- `Accept: text/event-stream`：返回 SSE 流，供浏览器持续刷新终端内容

## 开发方式

源码入口是 [src/server.ts](/Users/wangyahui/workspace/term-gateway/src/server.ts)，主要开发流程如下：

1. 修改 `src/` 下的 TypeScript 源码
2. 使用 `npm run dev` 本地联调
3. 用 `curl` 或浏览器验证 `/api/sessions`、`/open/:id/:token`、`/s/:id`、`/api/sessions/:id/stream`
4. 用 `npm run build` 生成 `dist/`

当前仓库没有测试目录，也没有现成的自动化测试脚本；现阶段更接近一个可运行的 MVP，而不是测试完备的发行版。

## 部署 / 发布

仓库当前能确认的部署信息主要是“作为一个普通 Node 服务运行，再接一个隧道或反向代理”。

### Cloudflare Tunnel

仓库提供了示例文件 [cloudflared/config.example.yml](/Users/wangyahui/workspace/term-gateway/cloudflared/config.example.yml)：

```yaml
tunnel: <YOUR_TUNNEL_UUID>
credentials-file: /etc/cloudflared/<YOUR_TUNNEL_UUID>.json

ingress:
  - hostname: <YOUR_PUBLIC_HOSTNAME>
    service: http://<TERM_GATEWAY_HOST>:<TERM_GATEWAY_PORT>
  - service: http_status:404
```

部署时至少需要确认：

- `PUBLIC_BASE_URL` 使用最终公网地址，例如 `https://term.example.com`
- `COOKIE_SECURE=true`
- `cloudflared` 的 `hostname` 与 `PUBLIC_BASE_URL` 一致
- `cloudflared` 的 `service` 指向 `http://HOST:PORT`

### 当前仓库未提供

- Dockerfile / docker-compose
- systemd、PM2 或其他进程管理配置
- GitHub Actions 或其他发布流水线
- npm 包发布配置

如果要把它作为公共服务长期运行，这些部署与运维说明仍需要补充。

## FAQ / 注意事项

### 为什么直接访问 `/s/:id` 会返回 401？

因为访问流程要求先走一次 `/open/:id/:token`。这个入口会验证限时 token，并写入签名 cookie。

### `open` 链接是一次性的吗？

当前实现能确认的是“限时有效”，默认 30 分钟。数据库 schema 里预留了 `consumedAt` 字段，但现有代码不会把 token 标记为已消费，所以 README 不应把它描述成一次性链接。

### 为什么页面显示 `unsupported` 或 `unavailable`？

常见原因有：

- 宿主机没有安装 `tmux`
- `tmuxSession` 对应的会话不存在
- session 已被标记为 `closed`
- 网关无法执行 `tmux capture-pane`

### 这个项目能直接当交互式 Web Terminal 用吗？

不能。当前实现明确是只读模式，网页不接收终端输入。

### 它会自动清理 session 或自动关闭 tmux 吗？

不会。仓库里没有自动 TTL 清理、自动回收或后台调度逻辑。

### 字体许可证在哪里？

字体相关许可证在 [assets/fonts/licenses](/Users/wangyahui/workspace/term-gateway/assets/fonts/licenses) 下；这些文件只覆盖字体资源本身，不代表整个项目源码的根许可证。

## License

仓库根目录目前没有发现 `LICENSE` 文件，`package.json` 里也没有声明项目许可证。因此项目源码的 License 目前无法从仓库直接确认，公开发布前建议补充明确的根许可证文件。
