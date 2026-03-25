import type { SessionRecord } from "./types.js";

interface SessionPageOptions {
  streamUrl: string;
  ttydAvailable: boolean;
  ttydStatusMessage: string;
}

const FONT_STACK = [
  '"BlexMono Nerd Font"',
  '"JetBrainsMono Nerd Font"',
  '"MesloLGS NF"',
  '"Hack Nerd Font"',
  '"Iosevka Web"',
  '"SF Mono"',
  "Menlo",
  "Consolas",
  '"Liberation Mono"',
  "monospace"
].join(", ");

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderSessionPage(session: SessionRecord, options: SessionPageOptions): string {
  const terminalSection = options.ttydAvailable
    ? `<main class="terminal-root">
        <iframe
          class="terminal-frame"
          src="${escapeHtml(options.streamUrl)}"
          title="Terminal stream ${escapeHtml(session.id)}"
          loading="lazy"
          referrerpolicy="same-origin"
        ></iframe>
      </main>`
    : `<main class="status-root">
        <p>${escapeHtml(options.ttydStatusMessage)}</p>
      </main>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Term Gateway ${escapeHtml(session.id)}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: ${FONT_STACK};
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
        width: 100vw;
        min-width: 100vw;
        height: 100vh;
        min-height: 100vh;
        min-height: 100dvh;
        background: #111;
        overflow: hidden;
        overscroll-behavior: none;
      }
      .terminal-root,
      .status-root {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        height: 100dvh;
        padding-top: env(safe-area-inset-top, 0px);
        padding-right: env(safe-area-inset-right, 0px);
        padding-bottom: env(safe-area-inset-bottom, 0px);
        padding-left: env(safe-area-inset-left, 0px);
        background: #111;
        overflow: hidden;
        overscroll-behavior: none;
      }
      .status-root {
        display: grid;
        place-items: center;
        padding-inline: max(16px, env(safe-area-inset-left, 0px), env(safe-area-inset-right, 0px));
        padding-top: max(16px, env(safe-area-inset-top, 0px));
        padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
      }
      .status-root p {
        margin: 0;
        max-width: 48rem;
        line-height: 1.5;
      }
      .terminal-frame {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: #111;
        overscroll-behavior: contain;
        touch-action: pan-y pinch-zoom;
      }
      @supports (height: 100svh) {
        body,
        .terminal-root,
        .status-root {
          height: 100svh;
        }
      }
    </style>
  </head>
  <body>
    ${terminalSection}
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
    <style>
      :root {
        color-scheme: dark;
        font-family: ${FONT_STACK};
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

export function renderTtydUnavailablePage(_session: SessionRecord, reason: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Terminal unavailable</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: ${FONT_STACK};
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
      }
      article {
        max-width: 48rem;
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
    </style>
  </head>
  <body>
    <article>
      <h1>ttyd stream is not available</h1>
      <p>${escapeHtml(reason)}</p>
    </article>
  </body>
</html>`;
}
