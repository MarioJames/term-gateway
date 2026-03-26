import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { type RawData } from "ws";

import type { SessionRecord } from "./types.js";
import { getPreferredTmuxCommand } from "./tmux.js";

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 36;
const MAX_REPLAY_BYTES = 512 * 1024;
const DEFAULT_IDLE_DISPOSE_DELAY_MS = 10_000;
const WEBSOCKET_OPEN_STATE = 1;

export interface TerminalPtyRouteMatch {
  sessionId: string;
}

export interface PtySpawnSpec {
  file: string;
  args: string[];
}

interface PtyClientMessage {
  type?: string;
  cols?: number;
  rows?: number;
  data?: string;
}

export type PtyRuntimeExitReason = "bridge_exit" | "idle_timeout" | "launch_failed" | "session_closed";

interface PtyServerMessage {
  type: "ready" | "output" | "notice" | "exit";
  data?: string;
  readonly?: boolean;
  message?: string;
  exitCode?: number | null;
  resizeSupported?: boolean;
  connections?: number;
  idleTimeoutMs?: number;
  reason?: PtyRuntimeExitReason;
}

export interface PtySocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: "message", listener: (message: RawData) => void): void;
  on(event: "close" | "error", listener: () => void): void;
}

interface PtyClientState {
  socket: PtySocketLike;
  cols: number;
  rows: number;
}

interface PtyProcessExitEvent {
  exitCode: number | null;
  reason: Extract<PtyRuntimeExitReason, "bridge_exit" | "launch_failed">;
}

export interface PtyProcessBridge {
  readonly resizeSupported: boolean;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: PtyProcessExitEvent) => void): void;
}

export interface PtySessionManagerOptions {
  createProcess?: (spawnSpec: PtySpawnSpec, session: SessionRecord) => PtyProcessBridge;
  idleDisposeDelayMs?: number;
}

interface PtyDisposeDetails {
  reason: PtyRuntimeExitReason;
  message: string;
  exitCode?: number | null;
}

type PtyRuntimeState = "live" | "disposing" | "disposed";

export function matchTerminalPtyRoute(pathname: string): TerminalPtyRouteMatch | null {
  const match = pathname.match(/^\/api\/sessions\/([^/]+)\/pty\/?$/);
  if (!match) {
    return null;
  }

  return {
    sessionId: match[1]!
  };
}

export function buildReadonlyTmuxPtySpec(tmuxSession: string): PtySpawnSpec {
  return {
    file: "tmux",
    args: ["attach-session", "-r", "-t", tmuxSession]
  };
}

export class PtySessionManager {
  private readonly runtimes = new Map<string, PtyRuntime>();
  private readonly createProcess: (spawnSpec: PtySpawnSpec, session: SessionRecord) => PtyProcessBridge;
  private readonly idleDisposeDelayMs: number;

  constructor(options: PtySessionManagerOptions = {}) {
    this.createProcess = options.createProcess ?? ((spawnSpec) => createPythonPtyProcess(spawnSpec));
    this.idleDisposeDelayMs = options.idleDisposeDelayMs ?? DEFAULT_IDLE_DISPOSE_DELAY_MS;
  }

  async attachClient(session: SessionRecord, socket: PtySocketLike): Promise<void> {
    if (session.status === "closed") {
      if (socket.readyState === WEBSOCKET_OPEN_STATE) {
        socket.send(JSON.stringify({
          type: "exit",
          reason: "session_closed",
          message: "Session has already been closed."
        } satisfies PtyServerMessage));
      }

      socket.close();
      return;
    }

    try {
      const runtime = this.getOrCreateRuntime(session);
      runtime.attach(socket);
    } catch (error) {
      if (socket.readyState === WEBSOCKET_OPEN_STATE) {
        socket.send(JSON.stringify({
          type: "notice",
          message: error instanceof Error ? error.message : "Unable to start PTY bridge."
        } satisfies PtyServerMessage));
      }

      socket.close();
    }
  }

  disposeSession(
    sessionId: string,
    details: PtyDisposeDetails = {
      reason: "session_closed",
      message: "Session was closed by the gateway."
    }
  ): void {
    this.runtimes.get(sessionId)?.dispose(details);
  }

  private getOrCreateRuntime(session: SessionRecord): PtyRuntime {
    const existing = this.runtimes.get(session.id);
    if (existing) {
      return existing;
    }

    const runtime = new PtyRuntime(
      session,
      this.createProcess(buildReadonlyTmuxPtySpec(session.tmuxSession), session),
      this.idleDisposeDelayMs,
      () => {
        this.runtimes.delete(session.id);
      }
    );

    this.runtimes.set(session.id, runtime);
    return runtime;
  }
}

class PtyRuntime {
  private readonly clients = new Set<PtyClientState>();
  private replayBuffer = "";
  private lastCols = DEFAULT_COLS;
  private lastRows = DEFAULT_ROWS;
  private idleDisposeTimer: NodeJS.Timeout | null = null;
  private state: PtyRuntimeState = "live";

  constructor(
    private readonly session: SessionRecord,
    private readonly ptyProcess: PtyProcessBridge,
    private readonly idleDisposeDelayMs: number,
    private readonly onDispose: () => void
  ) {
    this.ptyProcess.onData((data) => {
      if (this.state !== "live") {
        return;
      }

      this.appendReplay(data);
      this.broadcast({
        type: "output",
        data
      });
    });

    this.ptyProcess.onExit(({ exitCode, reason }) => {
      this.dispose({
        reason,
        exitCode,
        message:
          reason === "launch_failed"
            ? "PTY bridge failed to launch."
            : `PTY bridge exited with code ${exitCode ?? "unknown"}.`
      }, { killProcess: false });
    });
  }

  attach(socket: PtySocketLike): void {
    if (this.state !== "live") {
      if (socket.readyState === WEBSOCKET_OPEN_STATE) {
        socket.send(JSON.stringify({
          type: "exit",
          reason: "bridge_exit",
          message: "PTY runtime is no longer available."
        } satisfies PtyServerMessage));
      }

      socket.close();
      return;
    }

    this.clearIdleDisposeTimer();

    const client: PtyClientState = {
      socket,
      cols: this.lastCols,
      rows: this.lastRows
    };

    this.clients.add(client);

    socket.on("message", (message: RawData) => {
      this.handleClientMessage(client, message);
    });

    socket.on("close", () => {
      this.detach(client);
    });

    socket.on("error", () => {
      socket.close();
    });

    this.send(client.socket, {
      type: "ready",
      readonly: this.session.accessMode === "readonly",
      resizeSupported: this.ptyProcess.resizeSupported,
      connections: this.clients.size,
      idleTimeoutMs: this.idleDisposeDelayMs,
      message: this.buildReadyMessage()
    });

    if (this.replayBuffer) {
      this.send(client.socket, {
        type: "output",
        data: this.replayBuffer
      });
    }
  }

  dispose(details: PtyDisposeDetails, options: { killProcess?: boolean } = {}): void {
    if (this.state !== "live") {
      return;
    }

    this.state = "disposing";
    this.clearIdleDisposeTimer();

    if (this.clients.size > 0) {
      this.broadcast({
        type: "exit",
        reason: details.reason,
        exitCode: details.exitCode ?? null,
        message: details.message
      });
    }

    for (const client of this.clients) {
      client.socket.close();
    }

    this.clients.clear();

    if (options.killProcess !== false) {
      this.ptyProcess.kill();
    }

    this.state = "disposed";
    this.onDispose();
  }

  private detach(client: PtyClientState): void {
    if (!this.clients.delete(client)) {
      return;
    }

    if (this.state !== "live") {
      return;
    }

    if (this.clients.size === 0) {
      this.scheduleIdleDispose();
      return;
    }

    this.recalculateSize();
  }

  private handleClientMessage(client: PtyClientState, message: RawData): void {
    let payload: PtyClientMessage;

    try {
      payload = JSON.parse(rawDataToString(message)) as PtyClientMessage;
    } catch {
      this.send(client.socket, {
        type: "notice",
        message: "Ignoring malformed PTY client message."
      });
      return;
    }

    if (payload.type === "resize") {
      client.cols = sanitizeTerminalSize(payload.cols, this.lastCols);
      client.rows = sanitizeTerminalSize(payload.rows, this.lastRows);
      this.recalculateSize();
      return;
    }

    if (payload.type === "input") {
      if (this.session.accessMode === "readonly") {
        this.send(client.socket, {
          type: "notice",
          message: "This terminal is readonly. Browser input is disabled."
        });
        return;
      }

      if (typeof payload.data === "string" && payload.data) {
        this.ptyProcess.write(payload.data);
      }
    }
  }

  private recalculateSize(): void {
    if (this.state !== "live" || this.clients.size === 0) {
      return;
    }

    const cols = Math.max(...Array.from(this.clients, (client) => client.cols));
    const rows = Math.max(...Array.from(this.clients, (client) => client.rows));

    if (cols === this.lastCols && rows === this.lastRows) {
      return;
    }

    this.lastCols = cols;
    this.lastRows = rows;
    this.ptyProcess.resize(cols, rows);
  }

  private scheduleIdleDispose(): void {
    if (this.idleDisposeTimer !== null) {
      return;
    }

    this.idleDisposeTimer = setTimeout(() => {
      this.idleDisposeTimer = null;

      if (this.state !== "live" || this.clients.size > 0) {
        return;
      }

      this.dispose({
        reason: "idle_timeout",
        message: `PTY runtime was reclaimed after ${this.idleDisposeDelayMs}ms with no viewers.`
      });
    }, this.idleDisposeDelayMs);

    this.idleDisposeTimer.unref?.();
  }

  private clearIdleDisposeTimer(): void {
    if (this.idleDisposeTimer === null) {
      return;
    }

    clearTimeout(this.idleDisposeTimer);
    this.idleDisposeTimer = null;
  }

  private buildReadyMessage(): string {
    const resizeSummary = this.ptyProcess.resizeSupported
      ? "Resize sync is active."
      : "Resize sync is best-effort only.";

    return `Attached to tmux session ${this.session.tmuxSession} through a PTY bridge. ${resizeSummary} ${this.clients.size} viewer(s) connected. Runtime idles out after ${Math.round(this.idleDisposeDelayMs / 1_000)}s with no viewers.`;
  }

  private appendReplay(data: string): void {
    this.replayBuffer = `${this.replayBuffer}${data}`;
    if (Buffer.byteLength(this.replayBuffer, "utf8") <= MAX_REPLAY_BYTES) {
      return;
    }

    let trimStart = Buffer.byteLength(this.replayBuffer, "utf8") - MAX_REPLAY_BYTES;
    while (trimStart < this.replayBuffer.length && (this.replayBuffer.charCodeAt(trimStart) & 0b1100_0000) === 0b1000_0000) {
      trimStart += 1;
    }

    this.replayBuffer = this.replayBuffer.slice(trimStart);
  }

  private broadcast(message: PtyServerMessage): void {
    for (const client of this.clients) {
      this.send(client.socket, message);
    }
  }

  private send(socket: PtySocketLike, message: PtyServerMessage): void {
    if (socket.readyState !== WEBSOCKET_OPEN_STATE) {
      return;
    }

    socket.send(JSON.stringify(message));
  }
}

interface PtyBridgeControlMessage {
  type: "resize";
  cols: number;
  rows: number;
}

function createPythonPtyProcess(spawnSpec: PtySpawnSpec): PtyProcessBridge {
  const helperPath = fileURLToPath(new URL("../scripts/pty_bridge.py", import.meta.url));
  if (!existsSync(helperPath)) {
    throw new Error(`PTY helper is missing at ${helperPath}`);
  }

  const child = spawn("python3", [helperPath, getPreferredTmuxCommand(spawnSpec.file), ...spawnSpec.args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TERM: "xterm-256color",
      TERM_GATEWAY_PTY_COLS: `${DEFAULT_COLS}`,
      TERM_GATEWAY_PTY_ROWS: `${DEFAULT_ROWS}`
    },
    stdio: ["pipe", "pipe", "pipe", "pipe"]
  });

  const controlChannel = child.stdio[3];
  const resizeSupported = isWritableStream(controlChannel);
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(event: PtyProcessExitEvent) => void>();
  let exitEmitted = false;

  const emitExit = (event: PtyProcessExitEvent) => {
    if (exitEmitted) {
      return;
    }

    exitEmitted = true;
    for (const listener of exitListeners) {
      listener(event);
    }
  };

  child.stdout.on("data", (chunk: Buffer | string) => {
    const data = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    for (const listener of dataListeners) {
      listener(data);
    }
  });

  child.stderr.on("data", (chunk: Buffer | string) => {
    const data = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    for (const listener of dataListeners) {
      listener(data);
    }
  });

  child.on("close", (exitCode) => {
    emitExit({
      exitCode,
      reason: "bridge_exit"
    });
  });

  child.on("error", (error) => {
    for (const listener of dataListeners) {
      listener(`\r\n[gateway] PTY launch failed: ${error.message}\r\n`);
    }

    emitExit({
      exitCode: 1,
      reason: "launch_failed"
    });
  });

  return {
    resizeSupported,
    write(data: string) {
      if (typeof data !== "string" || data.length === 0 || !child.stdin.writable) {
        return;
      }

      child.stdin.write(data);
    },
    resize(cols: number, rows: number) {
      if (!resizeSupported || controlChannel.destroyed) {
        return;
      }

      controlChannel.write(serializeBridgeControlMessage({
        type: "resize",
        cols,
        rows
      }));
    },
    kill() {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    },
    onData(listener: (data: string) => void) {
      dataListeners.add(listener);
    },
    onExit(listener: (event: PtyProcessExitEvent) => void) {
      exitListeners.add(listener);
    }
  };
}

function serializeBridgeControlMessage(message: PtyBridgeControlMessage): string {
  return `${JSON.stringify(message)}\n`;
}

function sanitizeTerminalSize(value: number | undefined, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(20, Math.min(parsed, 400));
}

function rawDataToString(message: RawData): string {
  if (typeof message === "string") {
    return message;
  }

  if (Buffer.isBuffer(message)) {
    return message.toString("utf8");
  }

  if (Array.isArray(message)) {
    return Buffer.concat(message).toString("utf8");
  }

  return Buffer.from(message).toString("utf8");
}

function isWritableStream(value: unknown): value is NodeJS.WritableStream & { destroyed?: boolean } {
  return typeof value === "object" && value !== null && typeof (value as NodeJS.WritableStream).write === "function";
}
