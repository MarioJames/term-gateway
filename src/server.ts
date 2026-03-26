import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  generateOpaqueValue,
  hashOpenToken,
  parseCookieHeader,
  safeCompare,
  serializeSessionCookie,
  signSessionCookie,
  verifySignedSessionCookie
} from "./auth.js";
import { closeSessionResources } from "./closeSession.js";
import { loadConfig } from "./config.js";
import { renderSessionPage, renderUnauthorizedPage } from "./html.js";
import { SessionRegistry, toSessionView } from "./registry.js";
import { createTerminalNoticeSnapshot, matchTerminalStreamRoute, readTerminalSnapshot } from "./terminalStream.js";
import type { CreateSessionInput, SessionRecord, TerminalSnapshot, TerminalStreamEvent } from "./types.js";

const config = loadConfig();
const registry = new SessionRegistry(config.databasePath, config.openTokenTtlSeconds);
const assetsRootPath = fileURLToPath(new URL("../assets", import.meta.url));

const ASSET_CONTENT_TYPES = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".ttf", "font/ttf"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".txt", "text/plain; charset=utf-8"]
]);

await registry.init();

const server = createServer(async (request, response) => {
  try {
    await routeRequest(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, {
      error: "internal_server_error",
      message: error instanceof Error ? error.message : "Unexpected error"
    });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`term-gateway listening on ${config.publicBaseUrl}`);
  console.log(`database path: ${config.databasePath}`);
  console.log(`open token ttl seconds: ${config.openTokenTtlSeconds}`);
});

async function routeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const requestUrl = new URL(request.url ?? "/", config.publicBaseUrl);
  const pathname = requestUrl.pathname;

  if ((method === "GET" || method === "HEAD") && pathname.startsWith("/assets/")) {
    await handleStaticAsset(response, pathname, method === "HEAD");
    return;
  }

  if (method === "POST" && pathname === "/api/sessions") {
    await handleCreateSession(request, response);
    return;
  }

  if (method === "GET" && pathname === "/api/sessions") {
    const sessions = await registry.listSessions();
    sendJson(response, 200, { sessions: sessions.map(toSessionView) });
    return;
  }

  const sessionDetailMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (method === "GET" && sessionDetailMatch) {
    const sessionId = sessionDetailMatch[1]!;
    const session = await registry.getSession(sessionId);
    if (!session) {
      sendJson(response, 404, { error: "not_found", message: "Session not found" });
      return;
    }

    sendJson(response, 200, { session: toSessionView(session) });
    return;
  }

  const closeMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/close$/);
  if (method === "POST" && closeMatch) {
    const sessionId = closeMatch[1]!;
    const session = await registry.getSession(sessionId);
    if (!session) {
      sendJson(response, 404, { error: "not_found", message: "Session not found" });
      return;
    }

    const closeResult = await closeSessionResources(session);
    session.status = "closed";
    session.updatedAt = closeResult.registryUpdatedAt;
    await registry.saveSession(session);

    sendJson(response, 200, {
      session: toSessionView(session),
      closeResult,
      message: closeResult.summary.closedAnyTarget
        ? "Session marked as closed and at least one backing resource was terminated."
        : "Session marked as closed. No backing resource was terminated."
    });
    return;
  }

  const openMatch = pathname.match(/^\/open\/([^/]+)\/([^/]+)$/);
  if (method === "GET" && openMatch) {
    await handleOpenLink(response, openMatch[1]!, openMatch[2]!);
    return;
  }

  const sessionPageMatch = pathname.match(/^\/s\/([^/]+)$/);
  if (method === "GET" && sessionPageMatch) {
    await handleSessionPage(request, response, sessionPageMatch[1]!);
    return;
  }

  const streamRoute = matchTerminalStreamRoute(pathname);
  if (method === "GET" && streamRoute) {
    await handleStreamRequest(request, response, streamRoute.sessionId);
    return;
  }

  sendJson(response, 404, {
    error: "not_found",
    message: `No route for ${method} ${pathname}`
  });
}

async function handleCreateSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const payload = (await readJsonBody(request)) as CreateSessionInput;
  const sessionId = generateOpaqueValue(18);
  const rawToken = generateOpaqueValue(24);
  const session = await registry.createSession(sessionId, payload, hashOpenToken(rawToken, config.sessionSecret));

  sendJson(response, 201, {
    session: toSessionView(session),
    openUrl: `${config.publicBaseUrl}/open/${session.id}/${rawToken}`
  });
}

async function handleOpenLink(response: ServerResponse, sessionId: string, rawToken: string): Promise<void> {
  const session = await registry.getSession(sessionId);
  if (!session) {
    sendJson(response, 404, { error: "not_found", message: "Session not found" });
    return;
  }

  const suppliedHash = hashOpenToken(rawToken, config.sessionSecret);
  const tokenMatches = safeCompare(session.openToken.hash, suppliedHash);
  const tokenExpiresAt = session.openToken.expiresAt;
  const tokenExpiryTime = tokenExpiresAt === null ? Number.NaN : Date.parse(tokenExpiresAt);
  const tokenExpired = Number.isNaN(tokenExpiryTime) || Date.now() > tokenExpiryTime;

  if (!tokenMatches || tokenExpired) {
    sendJson(response, 403, {
      error: "forbidden",
      message: "Open token is invalid or has expired"
    });
    return;
  }

  const now = new Date().toISOString();
  session.lastAccessAt = now;
  session.updatedAt = now;
  await registry.saveSession(session);

  const cookieValue = signSessionCookie(session.id, config.sessionSecret);
  response.statusCode = 302;
  response.setHeader("Set-Cookie", serializeSessionCookie(config.cookieName, cookieValue, config.cookieSecure));
  response.setHeader("Location", session.publicPath);
  response.end();
}

async function handleSessionPage(
  request: IncomingMessage,
  response: ServerResponse,
  sessionId: string
): Promise<void> {
  const session = await authenticateSessionAccess(request, sessionId);
  if (!session) {
    sendHtml(response, 401, renderUnauthorizedPage(sessionId));
    return;
  }

  await registry.touchSessionAccess(session);
  sendHtml(response, 200, renderSessionPage(session, {
    streamUrl: `/api/sessions/${encodeURIComponent(session.id)}/stream`
  }));
}

async function handleStreamRequest(
  request: IncomingMessage,
  response: ServerResponse,
  sessionId: string
): Promise<void> {
  const session = await authenticateSessionAccess(request, sessionId);
  if (!session) {
    sendJson(response, 401, {
      error: "unauthorized",
      message: "Session access requires the signed session cookie."
    });
    return;
  }

  await registry.touchSessionAccess(session);

  if (wantsEventStream(request)) {
    await openTerminalEventStream(request, response, session.id);
    return;
  }

  const snapshot = await readTerminalSnapshot(session);
  sendJson(response, 200, { snapshot });
}

async function handleStaticAsset(response: ServerResponse, pathname: string, headOnly: boolean): Promise<void> {
  const relativeAssetPath = decodeURIComponent(pathname.slice("/assets/".length));
  if (!relativeAssetPath || relativeAssetPath.endsWith("/")) {
    sendText(response, 404, "Asset not found");
    return;
  }

  const assetPath = resolve(assetsRootPath, relativeAssetPath);
  if (!isPathInsideDirectory(assetPath, assetsRootPath)) {
    sendText(response, 404, "Asset not found");
    return;
  }

  try {
    const assetStats = await stat(assetPath);
    if (!assetStats.isFile()) {
      sendText(response, 404, "Asset not found");
      return;
    }

    response.statusCode = 200;
    response.setHeader("Cache-Control", "public, max-age=86400");
    response.setHeader("Content-Length", `${assetStats.size}`);
    response.setHeader("Content-Type", getAssetContentType(assetPath));
    response.setHeader("X-Content-Type-Options", "nosniff");

    if (headOnly) {
      response.end();
      return;
    }

    const assetStream = createReadStream(assetPath);
    assetStream.on("error", (error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }

      sendText(response, 500, "Unable to read asset");
    });
    assetStream.pipe(response);
  } catch {
    sendText(response, 404, "Asset not found");
  }
}

async function authenticateSessionAccess(
  request: IncomingMessage,
  sessionId: string
): Promise<SessionRecord | null> {
  return authenticateSessionCookie(sessionId, request.headers.cookie);
}

async function authenticateSessionCookie(
  sessionId: string,
  cookieHeader: string | undefined
): Promise<SessionRecord | null> {
  const session = await registry.getSession(sessionId);
  if (!session) {
    return null;
  }

  const cookies = parseCookieHeader(cookieHeader);
  const rawCookie = cookies[config.cookieName];
  if (!rawCookie) {
    return null;
  }

  const signedSessionId = verifySignedSessionCookie(rawCookie, config.sessionSecret);
  if (signedSessionId !== sessionId) {
    return null;
  }

  return session;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(bufferChunk);

    const totalLength = chunks.reduce((size, current) => size + current.length, 0);
    if (totalLength > 1024 * 1024) {
      throw new Error("Request body too large");
    }
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendHtml(response: ServerResponse, statusCode: number, html: string): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(html);
}

async function openTerminalEventStream(
  request: IncomingMessage,
  response: ServerResponse,
  sessionId: string
): Promise<void> {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders();

  let sequence = 0;
  let closed = false;
  let polling = false;
  let lastFingerprint = "";

  const cleanup = () => {
    if (closed) {
      return;
    }

    closed = true;
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);

    if (!response.writableEnded) {
      response.end();
    }
  };

  const writeSnapshot = (snapshot: TerminalSnapshot) => {
    const event: TerminalStreamEvent = {
      ...snapshot,
      sequence
    };

    sequence += 1;
    lastFingerprint = fingerprintSnapshot(snapshot);
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const publishSnapshot = async () => {
    if (closed || polling) {
      return;
    }

    polling = true;

    try {
      const currentSession = await registry.getSession(sessionId);
      const snapshot = currentSession
        ? await readTerminalSnapshot(currentSession)
        : createTerminalNoticeSnapshot("unavailable", "Session was not found.");
      const fingerprint = fingerprintSnapshot(snapshot);

      if (sequence === 0 || fingerprint !== lastFingerprint) {
        writeSnapshot(snapshot);
      }
    } catch (error) {
      const snapshot = createTerminalNoticeSnapshot(
        "unavailable",
        error instanceof Error ? error.message : "Unexpected terminal bridge failure."
      );

      if (sequence === 0 || fingerprintSnapshot(snapshot) !== lastFingerprint) {
        writeSnapshot(snapshot);
      }
    } finally {
      polling = false;
    }
  };

  const pollTimer = setInterval(() => {
    void publishSnapshot();
  }, 1_000);
  const heartbeatTimer = setInterval(() => {
    if (!closed) {
      response.write(`: keep-alive ${Date.now()}\n\n`);
    }
  }, 15_000);

  request.on("close", cleanup);
  response.on("close", cleanup);

  await publishSnapshot();
}

function sendText(response: ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(body);
}

function getAssetContentType(assetPath: string): string {
  return ASSET_CONTENT_TYPES.get(extname(assetPath).toLowerCase()) ?? "application/octet-stream";
}

function isPathInsideDirectory(targetPath: string, directoryPath: string): boolean {
  return targetPath === directoryPath || targetPath.startsWith(`${directoryPath}${sep}`);
}

function wantsEventStream(request: IncomingMessage): boolean {
  return `${request.headers.accept ?? ""}`.toLowerCase().includes("text/event-stream");
}

function fingerprintSnapshot(snapshot: TerminalSnapshot): string {
  return JSON.stringify([
    snapshot.status,
    snapshot.message,
    snapshot.rows,
    snapshot.cols,
    snapshot.content
  ]);
}
