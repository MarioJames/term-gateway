import type { CreateSessionInput, SessionAccessMode, SessionMode } from "./types.js";

export const DEFAULT_SESSION_MODE: SessionMode = "snapshot";
export const DEFAULT_SESSION_ACCESS_MODE: SessionAccessMode = "readonly";

export function normalizeSessionMode(value: CreateSessionInput["mode"] | string | null | undefined): SessionMode {
  return value === "pty" ? "pty" : "snapshot";
}

export function normalizeSessionAccessMode(
  value: CreateSessionInput["accessMode"] | string | null | undefined
): SessionAccessMode {
  return value === "readonly" ? "readonly" : DEFAULT_SESSION_ACCESS_MODE;
}
