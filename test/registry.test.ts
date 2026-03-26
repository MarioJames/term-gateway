import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { SessionRegistry } from "../src/registry.ts";

test("SessionRegistry migrates legacy readonly mode rows to snapshot mode", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "term-gateway-registry-"));
  const databasePath = join(tempDir, "legacy.sqlite");

  try {
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        task_name TEXT NOT NULL,
        agent TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        tmux_session TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_access_at TEXT,
        public_path TEXT NOT NULL,
        open_token_hash TEXT NOT NULL,
        open_token_expires_at TEXT,
        open_token_consumed_at TEXT
      );
    `);

    database
      .prepare(`
        INSERT INTO sessions (
          id,
          task_name,
          agent,
          mode,
          status,
          tmux_session,
          created_at,
          updated_at,
          last_access_at,
          public_path,
          open_token_hash,
          open_token_expires_at,
          open_token_consumed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        "legacy-1",
        "demo-task",
        "codex",
        "readonly",
        "running",
        "demo",
        "2026-03-25T00:00:00.000Z",
        "2026-03-25T00:00:00.000Z",
        null,
        "/s/legacy-1",
        "hash",
        "2026-03-25T01:00:00.000Z",
        null
      );

    database.close();

    const registry = new SessionRegistry(databasePath, 1_800);
    await registry.init();

    const session = await registry.getSession("legacy-1");
    assert.ok(session);
    assert.equal(session.mode, "snapshot");
    assert.equal(session.accessMode, "readonly");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("SessionRegistry persists explicit pty mode sessions", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "term-gateway-registry-"));
  const databasePath = join(tempDir, "pty.sqlite");

  try {
    const registry = new SessionRegistry(databasePath, 1_800);
    await registry.init();

    const session = await registry.createSession(
      "pty-1",
      {
        taskName: "pty-demo",
        agent: "codex",
        tmuxSession: "demo",
        mode: "pty"
      },
      "hash"
    );

    assert.equal(session.mode, "pty");
    assert.equal(session.accessMode, "readonly");

    const reloaded = await registry.getSession("pty-1");
    assert.ok(reloaded);
    assert.equal(reloaded.mode, "pty");
    assert.equal(reloaded.accessMode, "readonly");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
