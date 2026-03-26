# PTY Mode Architecture

## Why

当前项目原本只有 `tmux capture-pane + JSON/SSE` 的 snapshot 方案。它适合只读观察，但不具备完整终端协议能力，无法正确表达 alternate screen、cursor movement、ANSI 控制序列和更接近真实终端的渲染状态。

这次演进的目标不是删除 snapshot，而是在现有仓库结构上增加一个可迭代的 `pty` 模式。

## Session Model

`sessions` 表现在拆成两个维度：

- `mode`: `snapshot | pty`
- `access_mode`: 当前固定为 `readonly`

兼容逻辑：

- 旧表里 `mode=readonly` 的记录会在启动迁移后变成 `mode=snapshot`
- open token、signed cookie、`publicPath=/s/:id`、session registry API 都继续复用

## Backend Shape

### Snapshot Path

保留原路径：

- `GET /api/sessions/:id/stream`
- `tmux capture-pane`
- JSON / SSE

### PTY Path

新增路径：

- `GET /api/sessions/:id/pty` with WebSocket upgrade

运行时结构：

1. 浏览器先沿用 `/open/:id/:token` 获取 signed cookie
2. 页面 `/s/:id` 根据 `session.mode` 判断接 `stream` 还是 `pty`
3. `pty` 模式下，server 在 upgrade 时校验 cookie 和 session mode
4. `PtySessionManager` 为单个 session 维护一个共享 runtime
5. runtime 通过仓库内的 [scripts/pty_bridge.py](/Users/wangyahui/workspace/term-gateway/scripts/pty_bridge.py) 启动：
   - `python3 scripts/pty_bridge.py <tmux> attach-session -r -t <tmuxSession>`
6. Python helper 用 `pty.openpty()` 创建真实 PTY，并把 tmux attach 的字节流回送给 Node
7. Node 通过额外控制 fd 把 `resize` 指令送给 Python helper，helper 对底层 PTY 执行真实 `winsize` 更新
8. Node 通过 WebSocket 把消息转发给前端 xterm.js

## Frontend Shape

页面 [src/html.ts](/Users/wangyahui/workspace/term-gateway/src/html.ts) 现在分成两套启动逻辑：

- `snapshot`：沿用 `EventSource`
- `pty`：加载 `xterm.js`、`@xterm/addon-fit`，通过 WebSocket 渲染服务端发来的 `output`

当前 WS 消息协议：

- client -> server
  - `resize`
  - `input`
- server -> client
  - `ready`
  - `output`
  - `notice`
  - `exit`

`ready` / `exit` 现在还会补充 runtime 元信息：

- `connections`
- `idleTimeoutMs`
- `reason`（exit 时）

## Current Boundaries

- 浏览器输入仍默认关闭，`access_mode` 只是为未来演进预留
- `pty` 模式现在绑定到已有 `tmuxSession`，还不负责托管新的 shell lifecycle
- 浏览器尺寸变化现在会通过 Node -> Python helper -> PTY 真同步到 `winsize`
- runtime 目前具备基础生命周期治理：共享 runtime、viewer 连接计数、最后一个 viewer 断开后的空闲回收、session 显式关闭时的主动回收、bridge 退出/启动失败时的统一收口
- PTY provider 当前依赖 `python3`
- `snapshot` 和 `pty` 都是只读，关闭仍由 `tmux kill-session` 负责

## Next Steps

1. 把 runtime 生命周期状态暴露到管理 API 或日志，便于排查“为什么被回收/为什么重建”
2. 视需求决定是否把 `access_mode` 从 `readonly` 扩展到可写，并增加输入审计/权限控制
3. 如果后续要支持“新开 shell”而不是只 attach tmux，再把 runtime target 从 `tmuxSession` 抽象成更通用的 terminal target
4. 评估是否需要把 idle timeout 变成配置项，并补一层更接近真实浏览器的端到端烟测
