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
        background: #000;
        color: #f2f5f7;
      }
      * { box-sizing: border-box; }
      html {
        width: 100%;
        height: 100%;
        background: #000;
        overflow: hidden;
        overscroll-behavior: none;
      }
      body {
        margin: 0;
        width: 100vw;
        height: 100vh;
        background: #000;
        overflow: hidden;
        overscroll-behavior: none;
        font-variant-ligatures: none;
        font-feature-settings: "liga" 0, "calt" 0;
      }
      .terminal-shell {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        background: #000;
        overflow: hidden;
      }
      .terminal-root,
      .terminal-scroll {
        width: 100%;
        height: 100%;
      }
      .terminal-root {
        overflow: hidden;
      }
      .terminal-scroll {
        overflow: auto;
        overscroll-behavior: none;
        background: #000;
      }
      .terminal-screen {
        width: 100%;
        min-height: 100%;
        background: #000;
        color: #f2f5f7;
        font-family: ${TERM_FONT_STACK};
        font-size: clamp(12px, 1.2vw, 14px);
        line-height: 1.35;
      }
      .terminal-pre {
        margin: 0;
        padding: 0;
        white-space: pre;
        word-break: normal;
        overflow-wrap: normal;
        tab-size: 8;
      }
      .terminal-xterm,
      .terminal-xterm .xterm,
      .terminal-xterm .xterm-viewport {
        width: 100%;
        height: 100%;
        background: #000;
      }
      .terminal-xterm .xterm-screen {
        width: 100% !important;
      }
      .terminal-xterm .xterm-helper-textarea {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 1px !important;
        height: 1px !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      .terminal-modal {
        position: fixed;
        inset: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(0, 0, 0, 0.84);
      }
      .terminal-modal[hidden] {
        display: none !important;
      }
      .terminal-modal-card {
        width: min(420px, 100%);
        padding: 24px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: #121212;
      }
      .terminal-modal-title {
        margin: 0 0 10px;
        font-size: 18px;
        font-weight: 700;
      }
      .terminal-modal-copy {
        margin: 0;
        color: #c7d0d9;
        font-size: 14px;
        line-height: 1.5;
      }
      .terminal-modal-actions {
        display: flex;
        gap: 12px;
        margin-top: 20px;
      }
      .terminal-modal-button {
        appearance: none;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: #1e1e1e;
        color: #f5f7f8;
        padding: 10px 14px;
        font: inherit;
        cursor: pointer;
      }
      .terminal-modal-button:hover {
        background: #262626;
      }
      .terminal-modal-button:focus-visible {
        outline: 2px solid #8fd3ff;
        outline-offset: 2px;
      }
      @media (max-width: 720px) {
        .terminal-screen {
          font-size: clamp(12px, 3.3vw, 13px);
        }
        .terminal-modal {
          padding: 16px;
        }
        .terminal-modal-card {
          padding: 20px;
        }
        .terminal-modal-actions {
          flex-direction: column;
        }
        .terminal-modal-button {
          width: 100%;
        }
      }
      @supports (height: 100dvh) {
        body,
        .terminal-shell {
          height: 100dvh;
        }
      }
      @supports (height: 100svh) {
        body,
        .terminal-shell {
          height: 100svh;
        }
      }
    </style>
  </head>
  <body>
    <div class="terminal-shell">
      <main class="terminal-root">
        <div class="terminal-scroll" id="terminal-scroll">
          ${terminalMarkup}
        </div>
      </main>
      <section class="terminal-modal" id="terminal-modal" hidden>
        <div class="terminal-modal-card" role="alertdialog" aria-modal="true" aria-labelledby="terminal-modal-title">
          <h1 class="terminal-modal-title" id="terminal-modal-title">Connection lost</h1>
          <p class="terminal-modal-copy" id="terminal-modal-copy"></p>
          <div class="terminal-modal-actions">
            <button class="terminal-modal-button" id="modal-primary-action" type="button">Reconnect terminal</button>
            <button class="terminal-modal-button" id="modal-secondary-action" type="button">Close page</button>
          </div>
        </div>
      </section>
    </div>
    <script>
      (() => {
        const session = ${pageState};
        const scrollElement = document.getElementById("terminal-scroll");
        const screenElement = document.getElementById("terminal-screen");
        const modalElement = document.getElementById("terminal-modal");
        const modalTitleElement = document.getElementById("terminal-modal-title");
        const modalCopyElement = document.getElementById("terminal-modal-copy");
        const modalPrimaryAction = document.getElementById("modal-primary-action");
        const modalSecondaryAction = document.getElementById("modal-secondary-action");

        if (!(scrollElement instanceof HTMLElement) ||
            !(screenElement instanceof HTMLElement) ||
            !(modalElement instanceof HTMLElement) ||
            !(modalTitleElement instanceof HTMLElement) ||
            !(modalCopyElement instanceof HTMLElement) ||
            !(modalPrimaryAction instanceof HTMLButtonElement) ||
            !(modalSecondaryAction instanceof HTMLButtonElement)) {
          return;
        }

        const closePage = () => {
          try {
            window.close();
          } catch {}

          window.location.replace("about:blank");
        };
        const setUpdatedAt = (value) => {
          scrollElement.dataset.updatedAt = typeof value === "string" ? value : "";
        };
        const hideBlockingModal = () => {
          modalElement.hidden = true;
          modalPrimaryAction.hidden = true;
          modalSecondaryAction.hidden = true;
          modalPrimaryAction.onclick = null;
          modalSecondaryAction.onclick = null;
        };
        function showBlockingModal(config) {
          modalTitleElement.textContent = config.title;
          modalCopyElement.textContent = config.message;

          modalPrimaryAction.hidden = !config.primaryLabel;
          modalPrimaryAction.textContent = config.primaryLabel || "";
          modalPrimaryAction.onclick = typeof config.primaryAction === "function"
            ? () => {
                config.primaryAction();
              }
            : null;

          modalSecondaryAction.hidden = !config.secondaryLabel;
          modalSecondaryAction.textContent = config.secondaryLabel || "";
          modalSecondaryAction.onclick = typeof config.secondaryAction === "function"
            ? () => {
                config.secondaryAction();
              }
            : null;

          modalElement.hidden = false;
        }
        const showReconnectModal = (message, reconnectAction) => {
          showBlockingModal({
            title: "Connection lost",
            message,
            primaryLabel: "Reconnect terminal",
            primaryAction: reconnectAction,
            secondaryLabel: "Close page",
            secondaryAction: closePage
          });
        };
        const showSessionClosedModal = (message) => {
          showBlockingModal({
            title: "Session unavailable",
            message,
            primaryLabel: "Close page",
            primaryAction: closePage
          });
        };

        let cleanup = () => {};
        if (session.mode === "pty") {
          cleanup = startPtyMode(
            session,
            screenElement,
            showBlockingModal,
            showReconnectModal,
            showSessionClosedModal,
            hideBlockingModal,
            closePage,
            setUpdatedAt
          );
        } else {
          cleanup = startSnapshotMode(
            session,
            scrollElement,
            screenElement,
            showReconnectModal,
            showSessionClosedModal,
            hideBlockingModal,
            setUpdatedAt
          );
        }

        window.addEventListener("beforeunload", () => {
          cleanup();
        }, { once: true });
      })();

      function startSnapshotMode(
        session,
        scrollElement,
        screenElement,
        showReconnectModal,
        showSessionClosedModal,
        hideBlockingModal,
        setUpdatedAt
      ) {
        let lastSequence = -1;
        let eventSource = null;

        const isPinnedToBottom = () =>
          scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight < 24;

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

          setUpdatedAt(payload.capturedAt);

          if (payload.status === "closed") {
            showSessionClosedModal(payload.message || "The terminal session has already been closed.");
            return;
          }

          if (payload.status && payload.status !== "ok") {
            showReconnectModal(
              payload.message || "The snapshot bridge is unavailable. Reconnect to try again.",
              reconnect
            );
            return;
          }

          hideBlockingModal();

          if (stickToBottom) {
            scrollElement.scrollTop = scrollElement.scrollHeight;
          }
        };
        const reconnect = () => {
          if (eventSource) {
            eventSource.close();
          }

          hideBlockingModal();
          eventSource = new EventSource(session.streamUrl);

          eventSource.onmessage = (event) => {
            try {
              const payload = JSON.parse(event.data);
              // 跳过已处理的序列号，避免重复渲染
              if (typeof payload.sequence === "number" && payload.sequence <= lastSequence) {
                return;
              }
              applySnapshot(payload);
            } catch {
              showReconnectModal(
                "The snapshot payload could not be parsed. Reconnect to retry the bridge.",
                reconnect
              );
            }
          };

          eventSource.onerror = () => {
            if (eventSource) {
              eventSource.close();
            }

            showReconnectModal(
              "The snapshot bridge disconnected. Reconnect to continue viewing this terminal.",
              reconnect
            );
          };
        };

        reconnect();

        return () => {
          if (eventSource) {
            eventSource.close();
          }
        };
      }

      function startPtyMode(
        session,
        screenElement,
        showBlockingModal,
        showReconnectModal,
        showSessionClosedModal,
        hideBlockingModal,
        closePage,
        setUpdatedAt
      ) {
        const TerminalCtor = globalThis.Terminal;
        const FitAddonCtor = globalThis.FitAddon && globalThis.FitAddon.FitAddon;

        if (typeof TerminalCtor !== "function" || typeof FitAddonCtor !== "function") {
          showBlockingModal({
            title: "Terminal unavailable",
            message: "xterm.js assets are unavailable on this gateway.",
            primaryLabel: "Close page",
            primaryAction: closePage
          });
          return () => {};
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
          disableStdin: true,
          customKeyEventHandler: () => false,
          fontFamily: ${serializeForInlineScript(TERM_FONT_STACK)},
          fontSize: pickTerminalFontSize(),
          scrollback: 5000,
          theme: {
            background: "#000",
            foreground: "#f2f5f7",
            cursor: "#f2f5f7"
          }
        });
        const fitAddon = new FitAddonCtor();
        terminal.loadAddon(fitAddon);
        terminal.open(screenElement);

        const hardenTerminalInput = () => {
          const helperTextarea = screenElement.querySelector("textarea");

          if (!(helperTextarea instanceof HTMLTextAreaElement)) {
            return;
          }

          helperTextarea.readOnly = true;
          helperTextarea.tabIndex = -1;
          helperTextarea.setAttribute("aria-hidden", "true");
          helperTextarea.setAttribute("autocapitalize", "off");
          helperTextarea.setAttribute("autocomplete", "off");
          helperTextarea.setAttribute("autocorrect", "off");
          helperTextarea.setAttribute("inputmode", "none");
          helperTextarea.blur();
        };
        const suppressTerminalFocus = () => {
          const activeElement = document.activeElement;

          if (activeElement instanceof HTMLElement && screenElement.contains(activeElement)) {
            activeElement.blur();
          }

          terminal.blur();
          hardenTerminalInput();
        };
        const blockTerminalPointerFocus = (event) => {
          if (event.cancelable) {
            event.preventDefault();
          }

          suppressTerminalFocus();
        };
        screenElement.addEventListener("click", blockTerminalPointerFocus, { capture: true });
        screenElement.addEventListener("pointerdown", blockTerminalPointerFocus, { capture: true });
        screenElement.addEventListener("mousedown", blockTerminalPointerFocus, { capture: true });
        screenElement.addEventListener("touchstart", blockTerminalPointerFocus, { capture: true, passive: false });
        screenElement.addEventListener("focusin", () => {
          suppressTerminalFocus();
        }, true);
        hardenTerminalInput();
        suppressTerminalFocus();

        const socketUrl = new URL(session.ptyUrl, window.location.href);
        socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";

        let socket = null;
        let resizeFrame = 0;
        let disposed = false;
        let closeHandled = false;
        const sendResize = () => {
          if (disposed) {
            return;
          }

          const nextFontSize = pickTerminalFontSize();
          if (terminal.options.fontSize !== nextFontSize) {
            terminal.options.fontSize = nextFontSize;
          }

          fitAddon.fit();

          if (!terminal.cols || !terminal.rows) {
            return;
          }

          if (!(socket instanceof WebSocket) || socket.readyState !== WebSocket.OPEN) {
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
          disposed = true;

          if (resizeFrame) {
            window.cancelAnimationFrame(resizeFrame);
            resizeFrame = 0;
          }

          window.removeEventListener("resize", queueResize);
          viewport && viewport.removeEventListener("resize", queueResize);
          viewport && viewport.removeEventListener("scroll", queueResize);
          resizeObserver && resizeObserver.disconnect();

          if (socket instanceof WebSocket) {
            socket.close();
          }

          terminal.dispose();
        };
        const connect = () => {
          if (disposed) {
            return;
          }

          if (socket instanceof WebSocket && socket.readyState === WebSocket.OPEN) {
            return;
          }

          closeHandled = false;
          hideBlockingModal();
          socket = new WebSocket(socketUrl);

          socket.addEventListener("open", () => {
            hideBlockingModal();
            hardenTerminalInput();
            suppressTerminalFocus();
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
                hideBlockingModal();
                queueResize();
                return;
              }

              if (payload.type === "notice") {
                setUpdatedAt(new Date().toISOString());
                return;
              }

              if (payload.type === "exit") {
                closeHandled = true;
                setUpdatedAt(new Date().toISOString());

                if (payload.reason === "session_closed" || payload.reason === "launch_failed") {
                  showSessionClosedModal(payload.message || "The PTY session is no longer available.");
                } else {
                  showReconnectModal(
                    payload.message || "The PTY bridge exited. Reconnect to continue.",
                    connect
                  );
                }

                if (socket instanceof WebSocket) {
                  socket.close();
                }
              }
            } catch {
              closeHandled = true;
              showReconnectModal(
                "The PTY payload could not be parsed. Reconnect to continue.",
                connect
              );
            }
          });

          socket.addEventListener("close", () => {
            if (disposed || closeHandled) {
              return;
            }

            showReconnectModal(
              "The PTY websocket disconnected. Reconnect to continue using this terminal.",
              connect
            );
          });

          socket.addEventListener("error", () => {
            if (disposed) {
              return;
            }

            showReconnectModal(
              "The PTY websocket failed. Reconnect to continue using this terminal.",
              connect
            );
          });
        };

        resizeObserver && resizeObserver.observe(screenElement);
        window.addEventListener("resize", queueResize);
        viewport && viewport.addEventListener("resize", queueResize);
        viewport && viewport.addEventListener("scroll", queueResize);
        queueResize();
        connect();
        return cleanup;
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
