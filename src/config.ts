import { resolve } from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  publicBaseUrl: string;
  sessionSecret: string;
  registryDir: string;
  cookieName: string;
  cookieSecure: boolean;
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

function parseBoolean(rawValue: string | undefined, fallback: boolean): boolean {
  if (rawValue === undefined) {
    return fallback;
  }

  return rawValue.toLowerCase() === "true";
}

export function loadConfig(): AppConfig {
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:4317").replace(/\/+$/, "");
  const registryDir = process.env.REGISTRY_DIR ?? "./data/sessions";

  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: parsePort(process.env.PORT, 4317),
    publicBaseUrl,
    sessionSecret: process.env.SESSION_SECRET ?? "change-me",
    registryDir: resolve(process.cwd(), registryDir),
    cookieName: process.env.COOKIE_NAME ?? "term_gateway_session",
    cookieSecure: parseBoolean(process.env.COOKIE_SECURE, false)
  };
}
