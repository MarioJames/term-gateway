import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CreateSessionInput, SessionRecord, SessionView } from "./types.js";

const DEFAULT_TTYD_PORT = 7681;
const DEFAULT_TTYD_UPSTREAM = `http://127.0.0.1:${DEFAULT_TTYD_PORT}`;

export class SessionRegistry {
  constructor(private readonly directory: string) {}

  async init(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  async listSessions(): Promise<SessionRecord[]> {
    await this.init();
    const entries = await readdir(this.directory);
    const sessionFiles = entries.filter((entry) => entry.endsWith(".json"));
    const sessions = await Promise.all(sessionFiles.map(async (entry) => this.readSessionFile(join(this.directory, entry))));

    return sessions.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    try {
      return await this.readSessionFile(this.filePath(id));
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }

      throw error;
    }
  }

  async createSession(id: string, input: CreateSessionInput, openTokenHash: string): Promise<SessionRecord> {
    const now = new Date().toISOString();
    const taskName = input.taskName?.trim() || "unnamed-task";
    const agent = input.agent?.trim() || "unknown";
    const tmuxSession = input.tmuxSession?.trim() || taskName;
    const ttyd = {
      enabled: input.ttyd?.enabled ?? false,
      port: input.ttyd?.port ?? DEFAULT_TTYD_PORT,
      upstreamUrl: input.ttyd?.upstreamUrl?.trim() || DEFAULT_TTYD_UPSTREAM
    };

    const session: SessionRecord = {
      id,
      taskName,
      agent,
      mode: "readonly",
      status: "running",
      tmuxSession,
      ttyd,
      createdAt: now,
      updatedAt: now,
      lastAccessAt: null,
      publicPath: `/s/${id}`,
      openToken: {
        hash: openTokenHash,
        expiresAt: null,
        consumedAt: null
      }
    };

    await this.saveSession(session);
    return session;
  }

  async saveSession(session: SessionRecord): Promise<void> {
    await this.init();
    await writeFile(this.filePath(session.id), `${JSON.stringify(session, null, 2)}\n`, "utf8");
  }

  async closeSession(id: string): Promise<SessionRecord | null> {
    const session = await this.getSession(id);
    if (!session) {
      return null;
    }

    const now = new Date().toISOString();
    session.status = "closed";
    session.updatedAt = now;
    await this.saveSession(session);
    return session;
  }

  async touchSessionAccess(session: SessionRecord): Promise<SessionRecord> {
    const now = new Date().toISOString();
    session.lastAccessAt = now;
    session.updatedAt = now;
    await this.saveSession(session);
    return session;
  }

  private filePath(id: string): string {
    return join(this.directory, `${id}.json`);
  }

  private async readSessionFile(filePath: string): Promise<SessionRecord> {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as SessionRecord;
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
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
