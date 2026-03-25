import { resolve } from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  publicBaseUrl: string;
  sessionSecret: string;
  databasePath: string;
  cookieName: string;
  cookieSecure: boolean;
  openTokenTtlSeconds: number;
}

function parsePort(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) {
    return fallback;
  }

  const port = Number.parseInt(rawValue, 10);
  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${rawValue}`);
  }

  return port;
}

function parsePositiveInteger(rawValue: string | undefined, fallback: number, name: string): number {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name} value: ${rawValue}`);
  }

  return parsed;
}

function parseBoolean(rawValue: string | undefined, fallback: boolean): boolean {
  if (rawValue === undefined) {
    return fallback;
  }

  return rawValue.toLowerCase() === "true";
}

function resolveDatabasePath(rawValue: string | undefined): string {
  const databasePath = rawValue ?? "./data/term-gateway.sqlite";
  return databasePath === ":memory:" ? databasePath : resolve(process.cwd(), databasePath);
}

export function loadConfig(): AppConfig {
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:4317").replace(/\/+$/, "");

  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: parsePort(process.env.PORT, 4317),
    publicBaseUrl,
    sessionSecret: process.env.SESSION_SECRET ?? "change-me",
    databasePath: resolveDatabasePath(process.env.DATABASE_PATH),
    cookieName: process.env.COOKIE_NAME ?? "term_gateway_session",
    cookieSecure: parseBoolean(process.env.COOKIE_SECURE, false),
    openTokenTtlSeconds: parsePositiveInteger(
      process.env.OPEN_TOKEN_TTL_SECONDS,
      30 * 60,
      "OPEN_TOKEN_TTL_SECONDS"
    )
  };
}
