import { TERM_FONT_STACK, TERM_FONT_STYLESHEET_PATH } from "./fonts.js";
import type { SessionRecord } from "./types.js";
import {
  XTERM_FIT_ADDON_SCRIPT_PATH,
  XTERM_SCRIPT_PATH,
  XTERM_STYLESHEET_PATH
} from "./vendorAssets.js";

interface SessionPageOptions {
  streamUrl: string;
  ptyUrl: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderSessionPage(session: SessionRecord, options: SessionPageOptions): string {
  const pageState = serializeForInlineScript({
    id: session.id,
    taskName: session.taskName,
    agent: session.agent,
    status: session.status,
    mode: session.mode,
    accessMode: session.accessMode,
    tmuxSession: session.tmuxSession,
    streamUrl: options.streamUrl,
    ptyUrl: options.ptyUrl
  });

  const isPtyMode = session.mode === "pty";
  const terminalMarkup = isPtyMode
    ? '<div class="terminal-screen terminal-xterm" id="terminal-screen"></div>'
    : '<pre class="terminal-screen terminal-pre" id="terminal-screen"></pre>';
  const runtimeAssets = isPtyMode
    ? `
    <link rel="stylesheet" href="${XTERM_STYLESHEET_PATH}" />
    <script src="${XTERM_SCRIPT_PATH}"></script>
    <script src="${XTERM_FIT_ADDON_SCRIPT_PATH}"></script>`
    : "";
  const sourceLabel = isPtyMode ? `tmux+pty:${escapeHtml(session.tmuxSession)}` : `tmux:${escapeHtml(session.tmuxSession)}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Term Gateway ${escapeHtml(session.id)}</title>
    <link rel="stylesheet" href="${TERM_FONT_STYLESHEET_PATH}" />${runtimeAssets}
    <style>
      :root {
        color-scheme: dark;
        font-family: ${TERM_FONT_STACK};
        background: #111;
        color: #e8e8e8;
      }
      * { box-sizing: border-box; }
      html {
        width: 100%;
        height: 100%;
        background: #111;
        overflow: hidden;
        overscroll-behavior: none;
      }
      body {
        margin: 0;
        width: 100%;
        min-height: 100vh;
        min-height: 100dvh;
        background: #111;
        overflow: hidden;
        overscroll-behavior: none;
        font-variant-ligatures: none;
        font-feature-settings: "liga" 0, "calt" 0;
      }
      .app-shell {
        position: fixed;
        inset: 0;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        min-height: 100vh;
        min-height: 100dvh;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 120px),
          #111;
      }
      .session-bar,
      .status-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding-top: max(12px, env(safe-area-inset-top, 0px));
        padding-right: max(16px, env(safe-area-inset-right, 0px));
        padding-bottom: 12px;
        padding-left: max(16px, env(safe-area-inset-left, 0px));
        background: rgba(17, 17, 17, 0.92);
        backdrop-filter: blur(12px);
      }
      .status-bar {
        padding-top: 12px;
        padding-bottom: max(12px, env(safe-area-inset-bottom, 0px));
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        color: #9fa7ad;
        font-size: 12px;
      }
      .session-meta,
      .session-badges {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .session-meta {
        overflow: hidden;
        flex: 1 1 auto;
      }
      .session-badges {
        flex: 0 0 auto;
      }
      .task-name {
        color: #f4f7f9;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .meta-chip,
      .status-chip {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        padding: 4px 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.03);
        color: #c8d0d7;
        font-size: 12px;
        white-space: nowrap;
      }
      .source-chip,
      .status-copy,
      .updated-copy {
        min-width: 0;
      }
      .source-chip {
        max-width: min(40vw, 320px);
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .status-chip {
        text-transform: lowercase;
      }
      .terminal-root {
        min-height: 0;
        padding-top: 10px;
        padding-bottom: 10px;
        padding-right: max(16px, env(safe-area-inset-right, 0px));
        padding-left: max(16px, env(safe-area-inset-left, 0px));
        overflow: hidden;
      }
      .terminal-scroll {
        height: 100%;
        min-height: 0;
        overflow: auto;
        overscroll-behavior: contain;
        background: #0b0b0b;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 18px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
      }
      .terminal-screen {
        min-height: 100%;
        color: #f2f5f7;
        font-family: ${TERM_FONT_STACK};
        font-size: clamp(13px, 1.4vw, 15px);
        line-height: 1.35;
      }
      .terminal-pre {
        margin: 0;
        padding: 16px;
        white-space: pre;
        word-break: normal;
        overflow-wrap: normal;
        tab-size: 8;
      }
      .terminal-xterm {
        height: 100%;
        padding: 12px;
      }
      .status-copy {
        overflow-wrap: anywhere;
      }
      .updated-copy {
        flex: 0 0 auto;
        white-space: nowrap;
        text-align: right;
      }
      @media (max-width: 720px) {
        .session-bar,
        .status-bar {
          gap: 8px;
          padding-right: max(12px, env(safe-area-inset-right, 0px));
          padding-left: max(12px, env(safe-area-inset-left, 0px));
        }
        .session-bar {
          align-items: flex-start;
          flex-wrap: wrap;
        }
        .session-meta,
        .session-badges {
          width: 100%;
          flex-wrap: wrap;
        }
        .task-name {
          width: 100%;
          white-space: normal;
          overflow-wrap: anywhere;
        }
        .meta-chip,
        .status-chip {
          min-height: 24px;
          padding: 3px 8px;
          font-size: clamp(11px, 3.2vw, 12px);
        }
        .source-chip {
          max-width: 100%;
        }
        .terminal-root {
          padding-top: 8px;
          padding-bottom: 8px;
          padding-right: max(12px, env(safe-area-inset-right, 0px));
          padding-left: max(12px, env(safe-area-inset-left, 0px));
        }
        .terminal-scroll {
          border-radius: 14px;
        }
        .terminal-screen {
          font-size: clamp(12px, 3.3vw, 13px);
        }
        .terminal-pre {
          padding: 12px;
        }
        .terminal-xterm {
          padding: 8px;
        }
        .status-bar {
          align-items: flex-start;
          flex-direction: column;
        }
        .updated-copy {
          text-align: left;
        }
      }
      @supports (height: 100svh) {
        body,
        .app-shell {
          height: 100svh;
        }
      }
    </style>
  </head>
  <body>
    <div class="app-shell">
      <header class="session-bar">
        <div class="session-meta">
          <strong class="task-name">${escapeHtml(session.taskName)}</strong>
          <span class="meta-chip">${escapeHtml(session.agent)}</span>
          <span class="meta-chip source-chip">${sourceLabel}</span>
        </div>
        <div class="session-badges">
          <span class="meta-chip">${escapeHtml(session.mode)}</span>
          <span class="meta-chip">${escapeHtml(session.accessMode)}</span>
          <span class="status-chip" id="stream-state">connecting</span>
        </div>
      </header>
      <main class="terminal-root">
        <div class="terminal-scroll" id="terminal-scroll">
          ${terminalMarkup}
        </div>
      </main>
      <footer class="status-bar">
        <span class="status-copy" id="stream-summary">Connecting to terminal bridge...</span>
        <span class="updated-copy" id="stream-updated">Waiting for first update</span>
      </footer>
    </div>
    <script>
      (() => {
        const session = ${pageState};
        const scrollElement = document.getElementById("terminal-scroll");
        const screenElement = document.getElementById("terminal-screen");
        const stateElement = document.getElementById("stream-state");
        const summaryElement = document.getElementById("stream-summary");
        const updatedElement = document.getElementById("stream-updated");

        if (!(scrollElement instanceof HTMLElement) ||
            !(screenElement instanceof HTMLElement) ||
            !(stateElement instanceof HTMLElement) ||
            !(summaryElement instanceof HTMLElement) ||
            !(updatedElement instanceof HTMLElement)) {
          return;
        }

        const setUpdatedAt = (value) => {
          if (!value) {
            updatedElement.textContent = "Waiting for first update";
            return;
          }

          const date = new Date(value);
          if (Number.isNaN(date.getTime())) {
            updatedElement.textContent = "Updated just now";
            return;
          }

          updatedElement.textContent = "Updated " + date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
          });
        };

        if (session.mode === "pty") {
          startPtyMode(session, screenElement, stateElement, summaryElement, setUpdatedAt);
          return;
        }

        startSnapshotMode(session, scrollElement, screenElement, stateElement, summaryElement, setUpdatedAt);
      })();

      function startSnapshotMode(session, scrollElement, screenElement, stateElement, summaryElement, setUpdatedAt) {
        let lastSequence = -1;

        const isPinnedToBottom = () =>
          scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight < 24;

        const formatSummary = (payload) => {
          const parts = ["Readonly snapshot bridge", "Source: tmux capture-pane"];

          if (payload.cols && payload.rows) {
            parts.push(payload.cols + "x" + payload.rows);
          }

          if (payload.message) {
            parts.push(payload.message);
          }

          return parts.join(" • ");
        };

        const applySnapshot = (payload) => {
          if (!payload || typeof payload !== "object") {
            return;
          }

          if (typeof payload.sequence === "number" && payload.sequence <= lastSequence) {
            return;
          }

          if (typeof payload.sequence === "number") {
            lastSequence = payload.sequence;
          }

          const stickToBottom = isPinnedToBottom();
          if (payload.status === "ok" || payload.content) {
            screenElement.textContent = typeof payload.content === "string" ? payload.content : "";
          }

          stateElement.textContent = typeof payload.status === "string" ? payload.status : "live";
          summaryElement.textContent = formatSummary(payload);
          setUpdatedAt(payload.capturedAt);

          if (stickToBottom) {
            scrollElement.scrollTop = scrollElement.scrollHeight;
          }
        };

        const eventSource = new EventSource(session.streamUrl);

        eventSource.onopen = () => {
          stateElement.textContent = "live";
        };

        eventSource.onmessage = (event) => {
          try {
            applySnapshot(JSON.parse(event.data));
          } catch {
            stateElement.textContent = "unavailable";
            summaryElement.textContent = "Unable to parse snapshot payload from gateway.";
          }
        };

        eventSource.onerror = () => {
          stateElement.textContent = "reconnecting";
          summaryElement.textContent = "Waiting for snapshot bridge to reconnect...";
        };

        window.addEventListener("beforeunload", () => {
          eventSource.close();
        }, { once: true });
      }

      function startPtyMode(session, screenElement, stateElement, summaryElement, setUpdatedAt) {
        const TerminalCtor = globalThis.Terminal;
        const FitAddonCtor = globalThis.FitAddon && globalThis.FitAddon.FitAddon;

        if (typeof TerminalCtor !== "function" || typeof FitAddonCtor !== "function") {
          stateElement.textContent = "unavailable";
          summaryElement.textContent = "xterm.js assets are unavailable on this gateway.";
          return;
        }

        const pickTerminalFontSize = () => {
          const width = Math.min(window.innerWidth || 0, screen.width || Number.POSITIVE_INFINITY);

          if (width <= 480) {
            return 12;
          }

          if (width <= 720) {
            return 13;
          }

          return 14;
        };
        const terminal = new TerminalCtor({
          allowTransparency: true,
          convertEol: false,
          disableStdin: session.accessMode === "readonly",
          fontFamily: ${serializeForInlineScript(TERM_FONT_STACK)},
          fontSize: pickTerminalFontSize(),
          scrollback: 5000,
          theme: {
            background: "#0b0b0b",
            foreground: "#f2f5f7",
            cursor: "#f2f5f7"
          }
        });
        const fitAddon = new FitAddonCtor();
        terminal.loadAddon(fitAddon);
        terminal.open(screenElement);

        const socketUrl = new URL(session.ptyUrl, window.location.href);
        socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";

        const socket = new WebSocket(socketUrl);
        let resizeFrame = 0;
        const sendResize = () => {
          const nextFontSize = pickTerminalFontSize();
          if (terminal.options.fontSize !== nextFontSize) {
            terminal.options.fontSize = nextFontSize;
          }

          fitAddon.fit();

          if (!terminal.cols || !terminal.rows) {
            return;
          }

          if (socket.readyState !== WebSocket.OPEN) {
            return;
          }

          socket.send(JSON.stringify({
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows
          }));
        };
        const queueResize = () => {
          if (resizeFrame) {
            return;
          }

          resizeFrame = window.requestAnimationFrame(() => {
            resizeFrame = 0;
            sendResize();
          });
        };
        const resizeObserver = typeof ResizeObserver === "function"
          ? new ResizeObserver(() => {
              queueResize();
            })
          : null;
        const viewport = window.visualViewport;
        const cleanup = () => {
          if (resizeFrame) {
            window.cancelAnimationFrame(resizeFrame);
            resizeFrame = 0;
          }

          window.removeEventListener("resize", queueResize);
          viewport && viewport.removeEventListener("resize", queueResize);
          viewport && viewport.removeEventListener("scroll", queueResize);
          resizeObserver && resizeObserver.disconnect();
          socket.close();
          terminal.dispose();
        };

        socket.addEventListener("open", () => {
          stateElement.textContent = "live";
          summaryElement.textContent = "Readonly PTY bridge via tmux attach-session";
          queueResize();
        });

        socket.addEventListener("message", (event) => {
          try {
            const payload = JSON.parse(event.data);

            if (payload.type === "output" && typeof payload.data === "string") {
              terminal.write(payload.data);
              setUpdatedAt(new Date().toISOString());
              return;
            }

            if (payload.type === "ready") {
              summaryElement.textContent = payload.message || "Attached to PTY bridge.";
              queueResize();
              return;
            }

            if (payload.type === "notice") {
              summaryElement.textContent = payload.message || "PTY bridge notice";
              terminal.writeln("");
              terminal.writeln("[gateway] " + summaryElement.textContent);
              setUpdatedAt(new Date().toISOString());
              return;
            }

            if (payload.type === "exit") {
              stateElement.textContent = "closed";
              summaryElement.textContent = payload.message || "PTY bridge exited.";
              terminal.writeln("");
              terminal.writeln("[gateway] " + summaryElement.textContent);
              setUpdatedAt(new Date().toISOString());
            }
          } catch {
            stateElement.textContent = "unavailable";
            summaryElement.textContent = "Unable to parse PTY payload from gateway.";
          }
        });

        socket.addEventListener("close", () => {
          if (stateElement.textContent !== "closed") {
            stateElement.textContent = "disconnected";
            summaryElement.textContent = "PTY websocket disconnected.";
          }
        });

        socket.addEventListener("error", () => {
          stateElement.textContent = "unavailable";
          summaryElement.textContent = "PTY websocket failed.";
        });

        resizeObserver && resizeObserver.observe(screenElement);
        window.addEventListener("resize", queueResize);
        viewport && viewport.addEventListener("resize", queueResize);
        viewport && viewport.addEventListener("scroll", queueResize);
        queueResize();
        window.addEventListener("beforeunload", () => {
          cleanup();
        }, { once: true });
      }
    </script>
  </body>
</html>`;
}

export function renderUnauthorizedPage(sessionId: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Unauthorized</title>
    <link rel="stylesheet" href="${TERM_FONT_STYLESHEET_PATH}" />
    <style>
      :root {
        color-scheme: dark;
        font-family: ${TERM_FONT_STACK};
        background: #111;
        color: #e8e8e8;
      }
      html {
        width: 100%;
        height: 100%;
        background: #111;
      }
      body {
        margin: 0;
        min-height: 100vh;
        min-height: 100dvh;
        display: grid;
        place-items: center;
        padding-top: max(16px, env(safe-area-inset-top, 0px));
        padding-right: max(16px, env(safe-area-inset-right, 0px));
        padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
        padding-left: max(16px, env(safe-area-inset-left, 0px));
      }
      .card {
        width: min(480px, 100%);
        padding: 24px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.03);
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.24);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 20px;
      }
      p {
        margin: 0;
        line-height: 1.5;
        color: #c8d0d7;
      }
      code {
        font-family: ${TERM_FONT_STACK};
      }
    </style>
  </head>
  <body>
    <section class="card">
      <h1>Unauthorized</h1>
      <p>
        Session <code>${escapeHtml(sessionId)}</code> requires a valid signed cookie issued via the open link.
      </p>
    </section>
  </body>
</html>`;
}

function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}
