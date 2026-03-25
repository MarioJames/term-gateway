import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import {
  generateOpaqueValue,
  hashOpenToken,
  parseCookieHeader,
  safeCompare,
  serializeSessionCookie,
  signSessionCookie,
  verifySignedSessionCookie
} from "./auth.js";
import { loadConfig } from "./config.js";
import { renderSessionPage, renderTtydUnavailablePage, renderUnauthorizedPage } from "./html.js";
import { SessionRegistry, toSessionView } from "./registry.js";
import {
  getTtydTarget,
  matchStreamRoute,
  proxyHttpRequest,
  proxyWebSocketUpgrade
} from "./ttydProxy.js";
import type { CreateSessionInput, SessionRecord } from "./types.js";

const config = loadConfig();
const registry = new SessionRegistry(config.registryDir);

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

server.on("upgrade", async (request, socket, head) => {
  try {
    await handleUpgradeRequest(request, socket, head);
  } catch (error) {
    console.error(error);
    if (!socket.destroyed) {
      socket.write("HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  }
});

server.listen(config.port, config.host, () => {
  console.log(`term-gateway listening on ${config.publicBaseUrl}`);
  console.log(`registry directory: ${config.registryDir}`);
});

async function routeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const requestUrl = new URL(request.url ?? "/", config.publicBaseUrl);
  const pathname = requestUrl.pathname;

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
    const session = await registry.closeSession(sessionId);
    if (!session) {
      sendJson(response, 404, { error: "not_found", message: "Session not found" });
      return;
    }

    sendJson(response, 200, {
      session: toSessionView(session),
      message: "Session registry entry marked as closed. tmux/ttyd are not terminated in the MVP."
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

  const streamRoute = matchStreamRoute(pathname);
  if (streamRoute) {
    await handleStreamRequest(request, response, requestUrl, streamRoute);
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

  if (!tokenMatches || session.openToken.consumedAt !== null) {
    sendJson(response, 403, {
      error: "forbidden",
      message: "Open token is invalid or has already been consumed"
    });
    return;
  }

  const now = new Date().toISOString();
  session.openToken.consumedAt = now;
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
  const ttydTarget = getTtydTarget(session);
  sendHtml(
    response,
    200,
    renderSessionPage(session, {
      streamUrl: `/api/sessions/${encodeURIComponent(session.id)}/stream/`,
      ttydAvailable: ttydTarget.target !== null,
      ttydStatusMessage:
        ttydTarget.reason ??
        `Embedded from ${session.ttyd.upstreamUrl}. The gateway does not add browser-side write controls.`
    })
  );
}

async function handleStreamRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  streamRoute: NonNullable<ReturnType<typeof matchStreamRoute>>
): Promise<void> {
  const session = await authenticateSessionAccess(request, streamRoute.sessionId);
  if (!session) {
    if (streamRoute.upstreamSuffix === "") {
      sendHtml(response, 401, renderUnauthorizedPage(streamRoute.sessionId));
      return;
    }

    response.statusCode = 401;
    response.end("Unauthorized");
    return;
  }

  if (requestUrl.pathname === `/api/sessions/${session.id}/stream`) {
    response.statusCode = 307;
    response.setHeader("Location", `/api/sessions/${encodeURIComponent(session.id)}/stream/`);
    response.end();
    return;
  }

  const ttydTarget = getTtydTarget(session);
  if (!ttydTarget.target) {
    if (streamRoute.upstreamSuffix === "") {
      sendHtml(response, 503, renderTtydUnavailablePage(session, ttydTarget.reason ?? "ttyd is unavailable"));
      return;
    }

    response.statusCode = 404;
    response.end("ttyd upstream is unavailable for this session");
    return;
  }

  if (streamRoute.upstreamSuffix === "") {
    await registry.touchSessionAccess(session);
  }

  await proxyHttpRequest(request, response, ttydTarget.target, requestUrl, streamRoute);
}

async function handleUpgradeRequest(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", config.publicBaseUrl);
  const streamRoute = matchStreamRoute(requestUrl.pathname);
  if (!streamRoute) {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const session = await authenticateSessionCookie(streamRoute.sessionId, request.headers.cookie);
  if (!session) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const ttydTarget = getTtydTarget(session);
  if (!ttydTarget.target) {
    socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  await registry.touchSessionAccess(session);
  proxyWebSocketUpgrade(request, socket, head, ttydTarget.target, requestUrl, streamRoute);
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
