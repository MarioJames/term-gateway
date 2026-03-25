import { request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import net from "node:net";
import type { Duplex } from "node:stream";
import tls from "node:tls";

import type { SessionRecord } from "./types.js";

export interface StreamRouteMatch {
  sessionId: string;
  upstreamSuffix: string;
}

export interface TtydTarget {
  proxyBasePath: string;
  upstreamBaseUrl: URL;
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

export function matchStreamRoute(pathname: string): StreamRouteMatch | null {
  const match = pathname.match(/^\/api\/sessions\/([^/]+)\/stream(?:\/(.*))?$/);
  if (!match) {
    return null;
  }

  return {
    sessionId: match[1]!,
    upstreamSuffix: match[2] ?? ""
  };
}

export function getTtydTarget(session: SessionRecord): { target: TtydTarget | null; reason: string | null } {
  if (!session.ttyd.enabled) {
    return {
      target: null,
      reason: "ttyd is disabled for this session."
    };
  }

  const upstreamUrl = session.ttyd.upstreamUrl.trim();
  if (!upstreamUrl) {
    return {
      target: null,
      reason: "ttyd upstream URL is not configured for this session."
    };
  }

  try {
    const parsed = new URL(upstreamUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        target: null,
        reason: `Unsupported ttyd upstream protocol: ${parsed.protocol}`
      };
    }

    if (!parsed.pathname.endsWith("/")) {
      parsed.pathname = `${parsed.pathname}/`;
    }

    return {
      target: {
        proxyBasePath: `/api/sessions/${encodeURIComponent(session.id)}/stream/`,
        upstreamBaseUrl: parsed
      },
      reason: null
    };
  } catch (error) {
    return {
      target: null,
      reason: error instanceof Error ? error.message : "Invalid ttyd upstream URL"
    };
  }
}

export async function proxyHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  target: TtydTarget,
  requestUrl: URL,
  streamRoute: StreamRouteMatch
): Promise<void> {
  const upstreamUrl = buildUpstreamUrl(target.upstreamBaseUrl, streamRoute.upstreamSuffix, requestUrl.search);
  const proxyRequest = (upstreamUrl.protocol === "https:" ? httpsRequest : httpRequest)(
    upstreamUrl,
    {
      method: request.method,
      headers: buildProxyRequestHeaders(request.headers, upstreamUrl)
    },
    (proxyResponse) => {
      const statusCode = proxyResponse.statusCode ?? 502;
      const contentType = `${proxyResponse.headers["content-type"] ?? ""}`.toLowerCase();
      const shouldRewriteHtml = contentType.includes("text/html");

      if (!shouldRewriteHtml) {
        response.writeHead(
          statusCode,
          sanitizeProxyResponseHeaders(proxyResponse.headers, undefined, target.proxyBasePath, target.upstreamBaseUrl)
        );
        proxyResponse.pipe(response);
        return;
      }

      const chunks: Buffer[] = [];
      proxyResponse.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      proxyResponse.on("end", () => {
        const rewrittenHtml = rewriteHtmlDocument(
          Buffer.concat(chunks).toString("utf8"),
          target.proxyBasePath
        );
        const headers = sanitizeProxyResponseHeaders(
          proxyResponse.headers,
          Buffer.byteLength(rewrittenHtml),
          target.proxyBasePath,
          target.upstreamBaseUrl
        );
        response.writeHead(statusCode, headers);
        response.end(rewrittenHtml);
      });
    }
  );

  proxyRequest.on("error", (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }

    response.statusCode = 502;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(`Unable to reach ttyd upstream: ${error.message}`);
  });

  request.on("aborted", () => {
    proxyRequest.destroy();
  });

  request.pipe(proxyRequest);
}

export function proxyWebSocketUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  target: TtydTarget,
  requestUrl: URL,
  streamRoute: StreamRouteMatch
): void {
  const upstreamUrl = buildUpstreamUrl(target.upstreamBaseUrl, streamRoute.upstreamSuffix, requestUrl.search);
  const isTls = upstreamUrl.protocol === "https:";
  const upstreamSocket = isTls
    ? tls.connect({
        host: upstreamUrl.hostname,
        port: Number.parseInt(upstreamUrl.port || "443", 10),
        servername: upstreamUrl.hostname
      })
    : net.connect({
        host: upstreamUrl.hostname,
        port: Number.parseInt(upstreamUrl.port || "80", 10)
      });

  upstreamSocket.on("connect", () => {
    const headers = buildUpgradeRequestHeaders(request.headers, upstreamUrl);
    const headerLines = serializeHeaderLines(headers);
    const requestLine = `${request.method ?? "GET"} ${upstreamUrl.pathname}${upstreamUrl.search} HTTP/${request.httpVersion}\r\n`;

    upstreamSocket.write(`${requestLine}${headerLines}\r\n`);
    if (head.length > 0) {
      upstreamSocket.write(head);
    }

    socket.pipe(upstreamSocket).pipe(socket);
  });

  upstreamSocket.on("error", () => {
    if (!socket.destroyed) {
      socket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  });

  socket.on("error", () => {
    upstreamSocket.destroy();
  });

  socket.on("close", () => {
    upstreamSocket.end();
  });
}

function buildUpstreamUrl(baseUrl: URL, upstreamSuffix: string, search: string): URL {
  const upstreamUrl = new URL(upstreamSuffix || ".", baseUrl);
  upstreamUrl.search = search;
  return upstreamUrl;
}

function buildProxyRequestHeaders(headers: IncomingMessage["headers"], upstreamUrl: URL): OutgoingHttpHeaders {
  const proxyHeaders: OutgoingHttpHeaders = {};

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase()) || name.toLowerCase() === "host") {
      continue;
    }

    if (name.toLowerCase() === "cookie") {
      continue;
    }

    if (name.toLowerCase() === "accept-encoding") {
      continue;
    }

    if (name.toLowerCase() === "origin") {
      proxyHeaders[name] = upstreamUrl.origin;
      continue;
    }

    proxyHeaders[name] = value;
  }

  proxyHeaders.host = upstreamUrl.host;
  proxyHeaders["x-forwarded-host"] = headers.host ?? "";
  proxyHeaders["x-forwarded-proto"] = "http";
  return proxyHeaders;
}

function buildUpgradeRequestHeaders(headers: IncomingMessage["headers"], upstreamUrl: URL): OutgoingHttpHeaders {
  const proxyHeaders = buildProxyRequestHeaders(headers, upstreamUrl);
  proxyHeaders.connection = "Upgrade";
  proxyHeaders.upgrade = headers.upgrade ?? "websocket";
  return proxyHeaders;
}

function sanitizeProxyResponseHeaders(
  headers: IncomingMessage["headers"],
  contentLength?: number,
  proxyBasePath?: string,
  upstreamBaseUrl?: URL
): OutgoingHttpHeaders {
  const responseHeaders: OutgoingHttpHeaders = {};

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      continue;
    }

    if (name.toLowerCase() === "content-security-policy" || name.toLowerCase() === "x-frame-options") {
      continue;
    }

    if (name.toLowerCase() === "location") {
      if (typeof value === "string" && proxyBasePath && upstreamBaseUrl) {
        responseHeaders.location = rewriteLocationHeader(value, proxyBasePath, upstreamBaseUrl);
      }
      continue;
    }

    if (name.toLowerCase() === "content-length" && contentLength !== undefined) {
      continue;
    }

    responseHeaders[name] = value;
  }

  if (contentLength !== undefined) {
    responseHeaders["content-length"] = `${contentLength}`;
  }

  return responseHeaders;
}

function rewriteHtmlDocument(html: string, proxyBasePath: string): string {
  const baseTag = `<base href="${proxyBasePath}" />`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, (match) => `${match}${baseTag}`);
  }

  return `${baseTag}${html}`;
}

function rewriteLocationHeader(location: string, proxyBasePath: string, upstreamBaseUrl: URL): string {
  try {
    const absoluteLocation = new URL(location, upstreamBaseUrl);
    const relativePath = stripBasePath(absoluteLocation.pathname, upstreamBaseUrl.pathname);
    return `${proxyBasePath}${relativePath}${absoluteLocation.search}${absoluteLocation.hash}`;
  } catch {
    return location;
  }
}

function stripBasePath(pathname: string, basePathname: string): string {
  if (!basePathname || basePathname === "/") {
    return pathname.replace(/^\/+/, "");
  }

  if (pathname.startsWith(basePathname)) {
    return pathname.slice(basePathname.length).replace(/^\/+/, "");
  }

  return pathname.replace(/^\/+/, "");
}

function serializeHeaderLines(headers: OutgoingHttpHeaders): string {
  return Object.entries(headers)
    .flatMap(([name, value]) => {
      if (value === undefined) {
        return [];
      }

      if (Array.isArray(value)) {
        return value.map((entry) => `${name}: ${entry}\r\n`);
      }

      return [`${name}: ${value}\r\n`];
    })
    .join("");
}
