export interface TtydConfig {
  enabled: boolean;
  port: number;
  upstreamUrl: string;
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
