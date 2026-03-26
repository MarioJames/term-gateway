import { TERM_FONT_STACK, TERM_FONT_STYLESHEET_PATH } from "./fonts.js";
import type { SessionRecord } from "./types.js";

interface SessionPageOptions {
  streamUrl: string;
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
    tmuxSession: session.tmuxSession,
    streamUrl: options.streamUrl
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Term Gateway ${escapeHtml(session.id)}</title>
    <link rel="stylesheet" href="${TERM_FONT_STYLESHEET_PATH}" />
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
        grid-template-rows: auto 1fr auto;
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
      }
      .task-name {
        color: #f4f7f9;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
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
      .status-chip {
        text-transform: lowercase;
      }
      .terminal-root {
        min-height: 0;
        padding-right: max(16px, env(safe-area-inset-right, 0px));
        padding-left: max(16px, env(safe-area-inset-left, 0px));
        overflow: hidden;
      }
      .terminal-scroll {
        height: 100%;
        overflow: auto;
        overscroll-behavior: contain;
        background: #0b0b0b;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 18px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
      }
      .terminal-screen {
        margin: 0;
        min-height: 100%;
        padding: 16px;
        color: #f2f5f7;
        font-family: ${TERM_FONT_STACK};
        font-size: clamp(13px, 1.4vw, 15px);
        line-height: 1.35;
        white-space: pre;
        word-break: normal;
        overflow-wrap: normal;
        tab-size: 8;
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
          <span class="meta-chip">tmux:${escapeHtml(session.tmuxSession)}</span>
        </div>
        <div class="session-badges">
          <span class="meta-chip">readonly</span>
          <span class="status-chip" id="stream-state">connecting</span>
        </div>
      </header>
      <main class="terminal-root">
        <div class="terminal-scroll" id="terminal-scroll">
          <pre class="terminal-screen" id="terminal-screen"></pre>
        </div>
      </main>
      <footer class="status-bar">
        <span id="stream-summary">Connecting to tmux bridge...</span>
        <span id="stream-updated">Waiting for first snapshot</span>
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

        let lastSequence = -1;

        const isPinnedToBottom = () =>
          scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight < 24;

        const formatUpdatedAt = (value) => {
          if (!value) {
            return "Waiting for first snapshot";
          }

          const date = new Date(value);
          if (Number.isNaN(date.getTime())) {
            return "Updated just now";
          }

          return "Updated " + date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
          });
        };

        const formatSummary = (payload) => {
          const parts = ["Readonly browser view", "Source: tmux"];

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
          updatedElement.textContent = formatUpdatedAt(payload.capturedAt);

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
            summaryElement.textContent = "Unable to parse stream payload from gateway.";
          }
        };

        eventSource.onerror = () => {
          stateElement.textContent = "reconnecting";
          summaryElement.textContent = "Waiting for tmux bridge to reconnect...";
        };

        window.addEventListener("beforeunload", () => {
          eventSource.close();
        }, { once: true });
      })();
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
        background: #111;
        color: #e8e8e8;
        font-variant-ligatures: none;
        font-feature-settings: "liga" 0, "calt" 0;
      }
      article {
        max-width: 40rem;
      }
      h1, p {
        margin: 0;
      }
      h1 {
        font-size: 1rem;
        font-weight: 600;
      }
      p {
        margin-top: 0.75rem;
        line-height: 1.5;
      }
      code { font-family: inherit; }
    </style>
  </head>
  <body>
    <article>
      <h1>Session access requires the time-limited open link</h1>
      <p>Use the original <code>/open/${escapeHtml(sessionId)}/&lt;token&gt;</code> link before it expires so the gateway can exchange it for a signed session cookie.</p>
    </article>
  </body>
</html>`;
}

function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
