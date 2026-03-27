import test from "node:test";
import assert from "node:assert/strict";

import { renderSessionPage } from "../src/html.ts";
import type { SessionRecord } from "../src/types.ts";

test("renderSessionPage includes narrow-screen layout rules for portrait mobile", () => {
  const html = renderSessionPage(createSessionRecord(), {
    streamUrl: "/api/sessions/session-1/stream",
    ptyUrl: "/api/sessions/session-1/pty"
  });

  assert.match(html, /@media \(max-width: 720px\)/);
  assert.match(html, /\.session-bar \{/);
  assert.match(html, /flex-wrap: wrap;/);
  assert.match(html, /font-size: clamp\(11px, 3\.2vw, 12px\);/);
});

test("renderSessionPage refits pty terminal on mobile viewport changes", () => {
  const html = renderSessionPage(createSessionRecord({ mode: "pty" }), {
    streamUrl: "/api/sessions/session-1/stream",
    ptyUrl: "/api/sessions/session-1/pty"
  });

  assert.match(html, /const viewport = window\.visualViewport;/);
  assert.match(html, /viewport\.addEventListener\("resize", queueResize\)/);
  assert.match(html, /fontSize: pickTerminalFontSize\(\)/);
});

function createSessionRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "session-1",
    taskName: "portrait-mobile-demo",
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
