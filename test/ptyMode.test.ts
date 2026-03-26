import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import {
  buildReadonlyTmuxPtySpec,
  matchTerminalPtyRoute,
  PtySessionManager,
  type PtyProcessBridge,
  type PtySocketLike
} from "../src/ptySession.ts";
import type { SessionRecord } from "../src/types.ts";

test("matchTerminalPtyRoute matches the pty websocket endpoint", () => {
  assert.deepEqual(matchTerminalPtyRoute("/api/sessions/demo-1/pty"), {
    sessionId: "demo-1"
  });
  assert.equal(matchTerminalPtyRoute("/api/sessions/demo-1/stream"), null);
});

test("buildReadonlyTmuxPtySpec uses readonly tmux attach-session", () => {
  assert.deepEqual(buildReadonlyTmuxPtySpec("demo"), {
    file: "tmux",
    args: ["attach-session", "-r", "-t", "demo"]
  });
});

test("pty bridge helper starts on the system python3 runtime", () => {
  const helperPath = fileURLToPath(new URL("../scripts/pty_bridge.py", import.meta.url));
  const result = spawnSync("python3", [helperPath], {
    encoding: "utf8"
  });

  assert.equal(result.status, 64);
  assert.match(result.stderr, /usage: pty_bridge\.py <command> \[args\.\.\.\]/);
});

test("PtySessionManager forwards aggregated resize updates to the PTY bridge", async () => {
  const bridge = new FakePtyProcessBridge();
  const manager = new PtySessionManager({
    createProcess: () => bridge,
    idleDisposeDelayMs: 5
  });
  const firstSocket = new FakeSocket();
  const secondSocket = new FakeSocket();
  const session = createSessionRecord();

  await manager.attachClient(session, firstSocket);
  firstSocket.emitJson({ type: "resize", cols: 80, rows: 24 });
  await manager.attachClient(session, secondSocket);
  secondSocket.emitJson({ type: "resize", cols: 160, rows: 50 });
  secondSocket.close();
  await delay(0);

  assert.deepEqual(bridge.resizeCalls, [
    { cols: 80, rows: 24 },
    { cols: 160, rows: 50 },
    { cols: 80, rows: 24 }
  ]);

  const readyPayloads = firstSocket.sentMessages
    .concat(secondSocket.sentMessages)
    .filter((payload): payload is { type: "ready"; connections: number } => payload.type === "ready");

  assert.deepEqual(
    readyPayloads.map((payload) => payload.connections),
    [1, 2]
  );
});

test("PtySessionManager disposes idle runtimes and recreates them on the next attach", async () => {
  const bridges: FakePtyProcessBridge[] = [];
  const manager = new PtySessionManager({
    createProcess: () => {
      const bridge = new FakePtyProcessBridge();
      bridges.push(bridge);
      return bridge;
    },
    idleDisposeDelayMs: 10
  });
  const session = createSessionRecord();
  const socket = new FakeSocket();

  await manager.attachClient(session, socket);
  socket.close();
  await delay(25);

  assert.equal(bridges.length, 1);
  assert.equal(bridges[0]!.killCalls, 1);

  const replacementSocket = new FakeSocket();
  await manager.attachClient(session, replacementSocket);

  assert.equal(bridges.length, 2);
});

test("PtySessionManager closes live clients when the session is explicitly disposed", async () => {
  const bridge = new FakePtyProcessBridge();
  const manager = new PtySessionManager({
    createProcess: () => bridge,
    idleDisposeDelayMs: 50
  });
  const session = createSessionRecord();
  const socket = new FakeSocket();

  await manager.attachClient(session, socket);
  manager.disposeSession(session.id, {
    reason: "session_closed",
    message: "Session was closed by the gateway."
  });
  await delay(0);

  assert.equal(socket.readyState, FakeSocket.CLOSED);
  assert.equal(bridge.killCalls, 1);
  assert.ok(
    socket.sentMessages.some(
      (payload) =>
        payload.type === "exit" &&
        payload.reason === "session_closed" &&
        payload.message === "Session was closed by the gateway."
    )
  );
});

function createSessionRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "session-1",
    taskName: "pty-demo",
    agent: "codex",
    mode: "pty",
    accessMode: "readonly",
    status: "running",
    tmuxSession: "demo",
    createdAt: "2026-03-26T00:00:00.000Z",
    updatedAt: "2026-03-26T00:00:00.000Z",
    lastAccessAt: null,
    publicPath: "/s/session-1",
    openToken: {
      hash: "hash",
      expiresAt: "2026-03-26T01:00:00.000Z",
      consumedAt: null
    },
    ...overrides
  };
}

class FakePtyProcessBridge implements PtyProcessBridge {
  readonly resizeSupported = true;
  readonly resizeCalls: Array<{ cols: number; rows: number }> = [];
  readonly writeCalls: string[] = [];
  killCalls = 0;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: { exitCode: number | null }) => void>();

  write(data: string): void {
    this.writeCalls.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizeCalls.push({ cols, rows });
  }

  kill(): void {
    this.killCalls += 1;
  }

  onData(listener: (data: string) => void): void {
    this.dataListeners.add(listener);
  }

  onExit(listener: (event: { exitCode: number | null }) => void): void {
    this.exitListeners.add(listener);
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  emitExit(exitCode: number | null): void {
    for (const listener of this.exitListeners) {
      listener({ exitCode });
    }
  }
}

class FakeSocket implements PtySocketLike {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readonly sentMessages: Array<Record<string, unknown>> = [];
  readyState = FakeSocket.OPEN;

  private readonly handlers = {
    message: new Set<(message: Buffer) => void>(),
    close: new Set<() => void>(),
    error: new Set<() => void>()
  };

  on(event: "message" | "close" | "error", listener: (...args: never[]) => void): void {
    if (event === "message") {
      this.handlers.message.add(listener as (message: Buffer) => void);
      return;
    }

    if (event === "close") {
      this.handlers.close.add(listener as () => void);
      return;
    }

    this.handlers.error.add(listener as () => void);
  }

  send(data: string): void {
    this.sentMessages.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    if (this.readyState === FakeSocket.CLOSED) {
      return;
    }

    this.readyState = FakeSocket.CLOSED;
    for (const listener of this.handlers.close) {
      listener();
    }
  }

  emitJson(payload: unknown): void {
    const message = Buffer.from(JSON.stringify(payload), "utf8");
    for (const listener of this.handlers.message) {
      listener(message);
    }
  }
}
