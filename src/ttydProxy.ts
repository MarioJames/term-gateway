import { request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import net from "node:net";
import type { Duplex } from "node:stream";
import tls from "node:tls";

import { TERM_FONT_FAMILY, TERM_FONT_STACK, TERM_FONT_STYLESHEET_PATH, TERM_XTERM_FONT_STACK } from "./fonts.js";
import type { SessionRecord } from "./types.js";

export const TTYD_PREFERRED_RENDERER_TYPE = "dom";

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

const TTYD_HEAD_INJECTION = String.raw`<link rel="stylesheet" href="${TERM_FONT_STYLESHEET_PATH}" />
<style>
html,
body {
  overscroll-behavior: contain;
}

body,
.xterm,
.xterm .xterm-rows,
.xterm-helper-textarea {
  font-family: ${TERM_FONT_STACK} !important;
  font-variant-ligatures: none !important;
  font-feature-settings: "liga" 0, "calt" 0 !important;
}

.xterm,
.xterm-viewport {
  touch-action: pan-y pinch-zoom !important;
}

.xterm-viewport {
  overscroll-behavior: contain !important;
  -webkit-overflow-scrolling: touch !important;
}
</style>
<script>
(() => {
  const desiredFontFamily = ${JSON.stringify(TERM_XTERM_FONT_STACK)};
  const terminalFontFamily = ${JSON.stringify(TERM_FONT_FAMILY)};
  const patchedMarker = Symbol.for("term-gateway.xterm-font-patched");
  const trackedTerminals = new Set();
  let activeTouchId = null;
  let lastClientY = 0;
  let refreshQueued = false;

  const toTouchArray = (touchList) => Array.from(touchList ?? []);

  const isTerminalLike = (value) =>
    value &&
    typeof value === "object" &&
    typeof value.open === "function" &&
    value.options &&
    typeof value.options === "object";

  const applyTerminalFont = (terminal) => {
    if (!isTerminalLike(terminal)) {
      return;
    }

    try {
      terminal.options.fontFamily = desiredFontFamily;
    } catch {
      // Ignore terminals that reject option writes.
    }
  };

  const rememberTerminal = (terminal) => {
    if (!isTerminalLike(terminal)) {
      return terminal;
    }

    trackedTerminals.add(terminal);
    applyTerminalFont(terminal);
    return terminal;
  };

  const discoverTrackedTerminals = () => {
    rememberTerminal(window.term);
    rememberTerminal(window.terminal);

    if (Array.isArray(window.terminals)) {
      for (const terminal of window.terminals) {
        rememberTerminal(terminal);
      }
    }
  };

  const refreshTerminal = (terminal) => {
    if (!isTerminalLike(terminal)) {
      return;
    }

    applyTerminalFont(terminal);

    try {
      const core = terminal._core;
      core?._charSizeService?.measure?.();
      core?._renderService?.clear?.();
      core?._viewport?.syncScrollArea?.();

      if (typeof terminal.rows === "number" && terminal.rows > 0 && typeof terminal.refresh === "function") {
        terminal.refresh(0, terminal.rows - 1);
      }
    } catch {
      // Ignore renderer-specific refresh failures and keep the terminal usable.
    }
  };

  const refreshTrackedTerminals = () => {
    discoverTrackedTerminals();

    for (const terminal of trackedTerminals) {
      refreshTerminal(terminal);
    }
  };

  const queueTerminalRefresh = () => {
    if (refreshQueued) {
      return;
    }

    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      refreshTrackedTerminals();
    });
  };

  const patchTerminalConstructor = (TerminalCtor) => {
    if (typeof TerminalCtor !== "function" || TerminalCtor[patchedMarker]) {
      return TerminalCtor;
    }

    const originalOpen = TerminalCtor.prototype?.open;
    if (typeof originalOpen === "function" && !originalOpen[patchedMarker]) {
      TerminalCtor.prototype.open = function(...args) {
        rememberTerminal(this);
        const result = originalOpen.apply(this, args);
        queueTerminalRefresh();
        return result;
      };
      Object.defineProperty(TerminalCtor.prototype.open, patchedMarker, {
        value: true
      });
    }

    class PatchedTerminal extends TerminalCtor {
      constructor(options = {}) {
        super({ ...options, fontFamily: desiredFontFamily });
        rememberTerminal(this);
      }
    }

    Object.defineProperty(PatchedTerminal, patchedMarker, {
      value: true
    });

    return PatchedTerminal;
  };

  const installTerminalPatch = () => {
    let currentTerminalCtor = window.Terminal;

    try {
      Object.defineProperty(window, "Terminal", {
        configurable: true,
        enumerable: true,
        get() {
          return currentTerminalCtor;
        },
        set(value) {
          currentTerminalCtor = patchTerminalConstructor(value);
        }
      });
    } catch {
      currentTerminalCtor = patchTerminalConstructor(currentTerminalCtor);
      window.Terminal = currentTerminalCtor;
      return;
    }

    currentTerminalCtor = patchTerminalConstructor(currentTerminalCtor);
  };

  const refreshAfterFontsLoad = async () => {
    if (!document.fonts || typeof document.fonts.load !== "function") {
      queueTerminalRefresh();
      return;
    }

    try {
      await Promise.all([
        document.fonts.load(\`400 1em "\${terminalFontFamily}"\`, "A\u4e2d\ue0b0"),
        document.fonts.load(\`700 1em "\${terminalFontFamily}"\`, "A\u4e2d\ue0b0"),
        document.fonts.ready
      ]);
    } catch {
      // Keep rendering even if the browser rejects one of the font probes.
    }

    queueTerminalRefresh();
  };

  const getViewport = () => {
    const viewport = document.querySelector(".xterm-viewport");
    return viewport instanceof HTMLElement ? viewport : null;
  };

  const getTerminalRoot = () => {
    const terminalRoot = document.querySelector(".xterm");
    return terminalRoot instanceof HTMLElement ? terminalRoot : null;
  };

  const prepareViewport = () => {
    const viewport = getViewport();
    if (!viewport) {
      return null;
    }

    viewport.style.touchAction = "pan-y pinch-zoom";
    viewport.style.overscrollBehavior = "contain";
    viewport.style.webkitOverflowScrolling = "touch";
    return viewport;
  };

  const shouldHandleTouch = (target) => {
    const terminalRoot = getTerminalRoot();
    return terminalRoot instanceof HTMLElement && target instanceof Node && terminalRoot.contains(target);
  };

  const resetTouch = () => {
    activeTouchId = null;
  };

  document.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1 || !shouldHandleTouch(event.target)) {
      return;
    }

    const viewport = prepareViewport();
    if (!viewport) {
      return;
    }

    activeTouchId = event.touches[0].identifier;
    lastClientY = event.touches[0].clientY;
  }, { capture: true, passive: true });

  document.addEventListener("touchmove", (event) => {
    if (activeTouchId === null) {
      return;
    }

    const touch = toTouchArray(event.touches).find((candidate) => candidate.identifier === activeTouchId);
    if (!touch) {
      return;
    }

    const viewport = prepareViewport();
    if (!viewport) {
      resetTouch();
      return;
    }

    const deltaY = lastClientY - touch.clientY;
    lastClientY = touch.clientY;

    if (deltaY === 0) {
      return;
    }

    viewport.scrollTop += deltaY;
    if (viewport.scrollHeight > viewport.clientHeight) {
      event.preventDefault();
    }
  }, { capture: true, passive: false });

  document.addEventListener("touchend", (event) => {
    if (activeTouchId === null) {
      return;
    }

    const stillActive = toTouchArray(event.touches).some((touch) => touch.identifier === activeTouchId);
    if (!stillActive) {
      resetTouch();
    }
  }, { capture: true, passive: true });

  document.addEventListener("touchcancel", resetTouch, { capture: true, passive: true });

  const observer = new MutationObserver(() => {
    prepareViewport();
  });

  installTerminalPatch();
  refreshAfterFontsLoad();
  window.addEventListener("resize", queueTerminalRefresh, { passive: true });

  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      prepareViewport();
      queueTerminalRefresh();
    }, { once: true });
  } else {
    prepareViewport();
    queueTerminalRefresh();
  }
})();
</script>`;

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
  const headInjection = `<base href="${proxyBasePath}" />${TTYD_HEAD_INJECTION}`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, (match) => `${match}${headInjection}`);
  }

  return `${headInjection}${html}`;
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
