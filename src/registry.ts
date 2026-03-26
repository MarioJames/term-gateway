import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { DEFAULT_SESSION_ACCESS_MODE, normalizeSessionAccessMode, normalizeSessionMode } from "./sessionModel.js";
import type { CreateSessionInput, SessionRecord, SessionView } from "./types.js";

interface SessionRow {
  id: string;
  task_name: string;
  agent: string;
  mode: string;
  access_mode?: string | null;
  status: string;
  tmux_session: string;
  created_at: string;
  updated_at: string;
  last_access_at: string | null;
  public_path: string;
  open_token_hash: string;
  open_token_expires_at: string | null;
  open_token_consumed_at: string | null;
}

interface TableInfoRow {
  name: string;
}

const SESSION_TABLE_COLUMNS = `
  id TEXT PRIMARY KEY,
  task_name TEXT NOT NULL,
  agent TEXT NOT NULL,
  mode TEXT NOT NULL,
  access_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  tmux_session TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_access_at TEXT,
  public_path TEXT NOT NULL,
  open_token_hash TEXT NOT NULL,
  open_token_expires_at TEXT,
  open_token_consumed_at TEXT
`;

const SESSION_INSERT_COLUMNS = `
  id,
  task_name,
  agent,
  mode,
  access_mode,
  status,
  tmux_session,
  created_at,
  updated_at,
  last_access_at,
  public_path,
  open_token_hash,
  open_token_expires_at,
  open_token_consumed_at
`;

const LEGACY_REMOVED_COLUMNS = new Set([
  "ttyd_enabled",
  "ttyd_port",
  "ttyd_upstream_url"
]);

export class SessionRegistry {
  private database: DatabaseSync | null = null;

  constructor(private readonly databasePath: string, private readonly openTokenTtlSeconds: number) {}

  async init(): Promise<void> {
    if (this.database !== null) {
      return;
    }

    if (this.databasePath !== ":memory:") {
      await mkdir(dirname(this.databasePath), { recursive: true });
    }

    this.database = new DatabaseSync(this.databasePath);
    this.migrateLegacySessionsTableIfNeeded();
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        ${SESSION_TABLE_COLUMNS}
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions (created_at DESC);
    `);
  }

  async listSessions(): Promise<SessionRecord[]> {
    const rows = this.getDatabase()
      .prepare("SELECT * FROM sessions ORDER BY created_at DESC")
      .all() as unknown as SessionRow[];

    return rows.map(mapSessionRow);
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const row = this.getDatabase()
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as unknown as SessionRow | undefined;

    return row ? mapSessionRow(row) : null;
  }

  async createSession(id: string, input: CreateSessionInput, openTokenHash: string): Promise<SessionRecord> {
    const now = new Date();
    const nowIso = now.toISOString();
    const openTokenExpiresAt = new Date(now.getTime() + this.openTokenTtlSeconds * 1_000).toISOString();
    const taskName = input.taskName?.trim() || "unnamed-task";
    const agent = input.agent?.trim() || "unknown";
    const tmuxSession = input.tmuxSession?.trim() || taskName;

    const session: SessionRecord = {
      id,
      taskName,
      agent,
      mode: normalizeSessionMode(input.mode),
      accessMode: normalizeSessionAccessMode(input.accessMode),
      status: "running",
      tmuxSession,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastAccessAt: null,
      publicPath: `/s/${id}`,
      openToken: {
        hash: openTokenHash,
        expiresAt: openTokenExpiresAt,
        consumedAt: null
      }
    };

    await this.saveSession(session);
    return session;
  }

  async saveSession(session: SessionRecord): Promise<void> {
    this.getDatabase()
      .prepare(`
        INSERT INTO sessions (
          ${SESSION_INSERT_COLUMNS}
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          task_name = excluded.task_name,
          agent = excluded.agent,
          mode = excluded.mode,
          access_mode = excluded.access_mode,
          status = excluded.status,
          tmux_session = excluded.tmux_session,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          last_access_at = excluded.last_access_at,
          public_path = excluded.public_path,
          open_token_hash = excluded.open_token_hash,
          open_token_expires_at = excluded.open_token_expires_at,
          open_token_consumed_at = excluded.open_token_consumed_at
      `)
      .run(
        session.id,
        session.taskName,
        session.agent,
        session.mode,
        session.accessMode,
        session.status,
        session.tmuxSession,
        session.createdAt,
        session.updatedAt,
        session.lastAccessAt,
        session.publicPath,
        session.openToken.hash,
        session.openToken.expiresAt,
        session.openToken.consumedAt
      );
  }

  async touchSessionAccess(session: SessionRecord): Promise<SessionRecord> {
    const now = new Date().toISOString();
    session.lastAccessAt = now;
    session.updatedAt = now;
    await this.saveSession(session);
    return session;
  }

  private migrateLegacySessionsTableIfNeeded(): void {
    const database = this.getDatabase();
    const tableExists = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'")
      .get() as { name: string } | undefined;

    if (!tableExists) {
      return;
    }

    const columns = database
      .prepare("SELECT name FROM pragma_table_info('sessions')")
      .all() as unknown as TableInfoRow[];

    const hasLegacyRemovedColumns = columns.some((column) => LEGACY_REMOVED_COLUMNS.has(column.name));
    const hasAccessModeColumn = columns.some((column) => column.name === "access_mode");

    if (!hasLegacyRemovedColumns && hasAccessModeColumn) {
      return;
    }

    database.exec("BEGIN IMMEDIATE");

    try {
      database.exec("ALTER TABLE sessions RENAME TO sessions_legacy");
      database.exec(`
        CREATE TABLE sessions (
          ${SESSION_TABLE_COLUMNS}
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions (created_at DESC);
      `);

      const legacyRows = database.prepare("SELECT * FROM sessions_legacy").all() as unknown as SessionRow[];
      const insertStatement = database.prepare(`
        INSERT INTO sessions (
          ${SESSION_INSERT_COLUMNS}
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const legacyRow of legacyRows) {
        const session = mapSessionRow(legacyRow);
        insertStatement.run(
          session.id,
          session.taskName,
          session.agent,
          session.mode,
          session.accessMode,
          session.status,
          session.tmuxSession,
          session.createdAt,
          session.updatedAt,
          session.lastAccessAt,
          session.publicPath,
          session.openToken.hash,
          session.openToken.expiresAt,
          session.openToken.consumedAt
        );
      }

      database.exec("DROP TABLE sessions_legacy");
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  private getDatabase(): DatabaseSync {
    if (this.database === null) {
      throw new Error("SessionRegistry.init() must be called before use");
    }

    return this.database;
  }
}

function mapSessionRow(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    taskName: row.task_name,
    agent: row.agent,
    mode: normalizeSessionMode(row.mode),
    accessMode: normalizeSessionAccessMode(row.access_mode ?? DEFAULT_SESSION_ACCESS_MODE),
    status: row.status as SessionRecord["status"],
    tmuxSession: row.tmux_session,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessAt: row.last_access_at,
    publicPath: row.public_path,
    openToken: {
      hash: row.open_token_hash,
      expiresAt: row.open_token_expires_at,
      consumedAt: row.open_token_consumed_at
    }
  };
}

export function toSessionView(session: SessionRecord): SessionView {
  return {
    ...session,
    openToken: {
      expiresAt: session.openToken.expiresAt,
      consumedAt: session.openToken.consumedAt
    }
  };
}
