export interface TtydConfig {
  enabled: boolean;
  port: number;
  upstreamUrl: string;
}

export type CloseTargetStatus =
  | "closed"
  | "failed"
  | "not_found"
  | "skipped"
  | "unsupported";

export interface CloseTargetResult {
  target: "tmux" | "ttyd";
  attempted: boolean;
  status: CloseTargetStatus;
  message: string;
  command?: string;
  pid?: number;
  signal?: "SIGTERM" | "SIGKILL";
  tmuxSession?: string;
  port?: number;
  upstreamUrl?: string;
}

export interface CloseSessionResult {
  requestedAt: string;
  sessionId: string;
  registryStatus: "closed";
  registryUpdatedAt: string;
  tmux: CloseTargetResult;
  ttyd: CloseTargetResult;
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
  ttyd: TtydConfig;
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
  ttyd?: Partial<TtydConfig>;
}
