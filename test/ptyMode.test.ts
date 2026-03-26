import test from "node:test";
import assert from "node:assert/strict";

import { buildReadonlyTmuxPtySpec, matchTerminalPtyRoute } from "../src/ptySession.ts";

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
