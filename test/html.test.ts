import test from "node:test";
import assert from "node:assert/strict";

import { renderSessionPage } from "../src/html.ts";
import type { SessionRecord } from "../src/types.ts";

test("renderSessionPage uses an immersive fullscreen terminal shell without header or footer chrome", () => {
  const html = renderSessionPage(createSessionRecord(), {
    streamUrl: "/api/sessions/session-1/stream",
    ptyUrl: "/api/sessions/session-1/pty"
  });

  assert.match(html, /\.terminal-shell \{/);
  assert.match(html, /width: 100vw;/);
  assert.match(html, /height: 100vh;/);
  assert.doesNotMatch(html, /<header class="session-bar">/);
  assert.doesNotMatch(html, /<footer class="status-bar">/);
  assert.doesNotMatch(html, /stream-state/);
  assert.doesNotMatch(html, /stream-summary/);
});

test("renderSessionPage includes a fullscreen blocking modal for reconnectable and terminal errors", () => {
  const html = renderSessionPage(createSessionRecord({ mode: "pty" }), {
    streamUrl: "/api/sessions/session-1/stream",
    ptyUrl: "/api/sessions/session-1/pty"
  });

  assert.match(html, /id="terminal-modal"/);
  assert.match(html, /id="modal-primary-action"/);
  assert.match(html, /id="modal-secondary-action"/);
  assert.match(html, /Reconnect terminal/);
  assert.match(html, /Close page/);
  assert.match(html, /payload\.reason === "session_closed"/);
  assert.match(html, /showBlockingModal\(/);
});

test("renderSessionPage suppresses terminal focus and mobile keyboard triggers in PTY mode", () => {
  const html = renderSessionPage(createSessionRecord({ mode: "pty" }), {
    streamUrl: "/api/sessions/session-1/stream",
    ptyUrl: "/api/sessions/session-1/pty"
  });

  assert.match(html, /disableStdin: true,/);
  assert.match(html, /customKeyEventHandler: \(\) => false,/);
  assert.match(html, /helperTextarea\.setAttribute\("inputmode", "none"\)/);
  assert.match(html, /screenElement\.addEventListener\("click", blockTerminalPointerFocus, \{ capture: true \}\)/);
  assert.match(html, /screenElement\.addEventListener\("pointerdown", blockTerminalPointerFocus, \{ capture: true \}\)/);
  assert.match(html, /terminal\.blur\(\)/);
});

function createSessionRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "session-1",
    taskName: "immersive-terminal-demo",
    agent: "codex",
    mode: "snapshot",
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
