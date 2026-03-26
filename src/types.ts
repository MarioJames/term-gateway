export type TerminalSnapshotStatus = "ok" | "closed" | "unavailable" | "unsupported";

export interface TerminalSnapshot {
  source: "tmux";
  status: TerminalSnapshotStatus;
  message: string | null;
  content: string;
  capturedAt: string;
  rows: number | null;
  cols: number | null;
}

export interface TerminalStreamEvent extends TerminalSnapshot {
  sequence: number;
}

export type CloseTargetStatus =
  | "closed"
  | "failed"
  | "not_found"
  | "skipped"
  | "unsupported";

export interface CloseTargetResult {
  target: "tmux";
  attempted: boolean;
  status: CloseTargetStatus;
  message: string;
  command?: string;
  tmuxSession?: string;
}

export interface CloseSessionResult {
  requestedAt: string;
  sessionId: string;
  registryStatus: "closed";
  registryUpdatedAt: string;
  tmux: CloseTargetResult;
  summary: {
    closedAnyTarget: boolean;
    hasFailures: boolean;
  };
}

export interface SessionOpenTokenRecord {
  hash: string;
  expiresAt: string | null;
  consumedAt: string | null;
}

export interface SessionOpenTokenView {
  expiresAt: string | null;
  consumedAt: string | null;
}

export type SessionMode = "readonly";
export type SessionStatus = "running" | "closed";

export interface SessionRecord {
  id: string;
  taskName: string;
  agent: string;
  mode: SessionMode;
  status: SessionStatus;
  tmuxSession: string;
  createdAt: string;
  updatedAt: string;
  lastAccessAt: string | null;
  publicPath: string;
  openToken: SessionOpenTokenRecord;
}

export interface SessionView extends Omit<SessionRecord, "openToken"> {
  openToken: SessionOpenTokenView;
}

export interface CreateSessionInput {
  taskName?: string;
  agent?: string;
  tmuxSession?: string;
}
