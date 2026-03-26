import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { WebSocket, type RawData } from "ws";

import type { SessionRecord } from "./types.js";
import { getPreferredTmuxCommand } from "./tmux.js";

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 36;
const MAX_REPLAY_BYTES = 512 * 1024;
const IDLE_DISPOSE_DELAY_MS = 10_000;

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

interface PtyServerMessage {
  type: "ready" | "output" | "notice" | "exit";
  data?: string;
  readonly?: boolean;
  message?: string;
  exitCode?: number | null;
  resizeSupported?: boolean;
}

interface PtyClientState {
  socket: WebSocket;
  cols: number;
  rows: number;
}

interface PtyProcessBridge {
  readonly resizeSupported: boolean;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number | null }) => void): void;
}

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

  async attachClient(session: SessionRecord, socket: WebSocket): Promise<void> {
    try {
      const runtime = this.getOrCreateRuntime(session);
      runtime.attach(socket);
    } catch (error) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "notice",
          message: error instanceof Error ? error.message : "Unable to start PTY bridge."
        }));
      }

      socket.close();
    }
  }

  private getOrCreateRuntime(session: SessionRecord): PtyRuntime {
    const existing = this.runtimes.get(session.id);
    if (existing) {
      return existing;
    }

    const runtime = new PtyRuntime(session, () => {
      this.runtimes.delete(session.id);
    });
    this.runtimes.set(session.id, runtime);
    return runtime;
  }
}

class PtyRuntime {
  private readonly ptyProcess: PtyProcessBridge;
  private readonly clients = new Set<PtyClientState>();
  private replayBuffer = "";
  private lastCols = DEFAULT_COLS;
  private lastRows = DEFAULT_ROWS;
  private disposeScheduled = false;

  constructor(
    private readonly session: SessionRecord,
    private readonly onDispose: () => void
  ) {
    this.ptyProcess = createPythonPtyProcess(buildReadonlyTmuxPtySpec(session.tmuxSession));

    this.ptyProcess.onData((data) => {
      this.appendReplay(data);
      this.broadcast({
        type: "output",
        data
      });
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      this.broadcast({
        type: "exit",
        exitCode,
        message: `PTY bridge exited with code ${exitCode ?? "unknown"}.`
      });
      this.dispose();
    });
  }

  attach(socket: WebSocket): void {
    const client: PtyClientState = {
      socket,
      cols: this.lastCols,
      rows: this.lastRows
    };

    this.clients.add(client);
    this.disposeScheduled = false;

    socket.on("message", (message: RawData) => {
      this.handleClientMessage(client, message);
    });

    socket.on("close", () => {
      this.clients.delete(client);
      this.recalculateSize();
      void this.disposeWhenIdle();
    });

    socket.on("error", () => {
      socket.close();
    });

    this.send(client.socket, {
      type: "ready",
      readonly: this.session.accessMode === "readonly",
      resizeSupported: this.ptyProcess.resizeSupported,
      message: this.ptyProcess.resizeSupported
        ? `Attached to tmux session ${this.session.tmuxSession} through a PTY bridge.`
        : `Attached to tmux session ${this.session.tmuxSession} through a PTY bridge. Resize is currently best-effort.`
    });

    if (this.replayBuffer) {
      this.send(client.socket, {
        type: "output",
        data: this.replayBuffer
      });
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
      client.cols = sanitizeTerminalSize(payload.cols, DEFAULT_COLS);
      client.rows = sanitizeTerminalSize(payload.rows, DEFAULT_ROWS);
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
    const cols = Math.max(...Array.from(this.clients, (client) => client.cols), DEFAULT_COLS);
    const rows = Math.max(...Array.from(this.clients, (client) => client.rows), DEFAULT_ROWS);

    if (cols === this.lastCols && rows === this.lastRows) {
      return;
    }

    this.lastCols = cols;
    this.lastRows = rows;
    this.ptyProcess.resize(cols, rows);
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

  private send(socket: WebSocket, message: PtyServerMessage): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(message));
  }

  private async disposeWhenIdle(): Promise<void> {
    if (this.disposeScheduled || this.clients.size > 0) {
      return;
    }

    this.disposeScheduled = true;
    await delay(IDLE_DISPOSE_DELAY_MS);

    if (this.clients.size === 0) {
      this.dispose();
    } else {
      this.disposeScheduled = false;
    }
  }

  private dispose(): void {
    for (const client of this.clients) {
      client.socket.close();
    }

    this.clients.clear();
    this.ptyProcess.kill();
    this.onDispose();
  }
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
    stdio: ["pipe", "pipe", "pipe"]
  });

  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(event: { exitCode: number | null }) => void>();

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
    for (const listener of exitListeners) {
      listener({ exitCode });
    }
  });

  child.on("error", (error) => {
    for (const listener of dataListeners) {
      listener(`\r\n[gateway] PTY launch failed: ${error.message}\r\n`);
    }

    for (const listener of exitListeners) {
      listener({ exitCode: 1 });
    }
  });

  return {
    resizeSupported: false,
    write(data: string) {
      child.stdin.write(data);
    },
    resize() {
      // The Python PTY helper currently uses the initial size only.
    },
    kill() {
      child.kill("SIGTERM");
    },
    onData(listener: (data: string) => void) {
      dataListeners.add(listener);
    },
    onExit(listener: (event: { exitCode: number | null }) => void) {
      exitListeners.add(listener);
    }
  };
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
