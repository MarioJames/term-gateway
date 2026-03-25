import type { SessionRecord } from "./types.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderRow(label: string, value: string): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

export function renderSessionPage(session: SessionRecord): string {
  const ttydMessage = session.ttyd.enabled
    ? "ttyd upstream has been configured, but the proxy layer is still a stub in this MVP."
    : "ttyd is not enabled for this session yet. This page is a read-only placeholder.";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Term Gateway ${escapeHtml(session.id)}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Iosevka Web", "SF Mono", Menlo, monospace;
        background: linear-gradient(180deg, #f7f3ea 0%, #ece4d8 100%);
        color: #1f1a14;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        padding: 32px 20px;
      }
      main {
        max-width: 960px;
        margin: 0 auto;
        background: rgba(255, 252, 247, 0.92);
        border: 1px solid #c9b99f;
        border-radius: 20px;
        padding: 28px;
        box-shadow: 0 20px 60px rgba(72, 54, 32, 0.12);
      }
      .badge {
        display: inline-block;
        margin-bottom: 16px;
        padding: 6px 10px;
        border-radius: 999px;
        background: #2a5c45;
        color: #f7f3ea;
        font-size: 13px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 30px;
      }
      p {
        line-height: 1.6;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin: 24px 0;
      }
      th, td {
        padding: 12px 10px;
        border-bottom: 1px solid #ddcfbb;
        text-align: left;
        vertical-align: top;
      }
      th {
        width: 220px;
        color: #65533f;
      }
      .panel {
        padding: 16px;
        border-radius: 16px;
        background: #f2eadf;
        border: 1px solid #d4c2ab;
      }
      code, pre {
        font-family: inherit;
      }
      pre {
        margin: 12px 0 0;
        padding: 14px;
        overflow: auto;
        border-radius: 12px;
        background: #16120d;
        color: #efe3d0;
      }
      a {
        color: #8f3d1f;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="badge">Read-only terminal session</div>
      <h1>${escapeHtml(session.taskName)}</h1>
      <p>This session is intentionally read-only in the MVP. To run commands, send instructions through chat instead of typing in the browser.</p>

      <table>
        <tbody>
          ${renderRow("Session ID", session.id)}
          ${renderRow("Agent", session.agent)}
          ${renderRow("Mode", session.mode)}
          ${renderRow("Status", session.status)}
          ${renderRow("tmux session", session.tmuxSession)}
          ${renderRow("Public path", session.publicPath)}
          ${renderRow("Created at", session.createdAt)}
          ${renderRow("Updated at", session.updatedAt)}
          ${renderRow("Last access at", session.lastAccessAt ?? "never")}
        </tbody>
      </table>

      <section class="panel">
        <strong>ttyd stub</strong>
        <p>${escapeHtml(ttydMessage)}</p>
        <p>Reserved stream endpoint: <a href="/api/sessions/${encodeURIComponent(session.id)}/stream">/api/sessions/${escapeHtml(session.id)}/stream</a></p>
        <pre>${escapeHtml(JSON.stringify(session.ttyd, null, 2))}</pre>
      </section>
    </main>
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
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        font-family: "Iosevka Web", "SF Mono", Menlo, monospace;
        background: #f7f3ea;
        color: #1f1a14;
      }
      article {
        max-width: 640px;
        padding: 24px;
        border: 1px solid #c9b99f;
        border-radius: 18px;
        background: #fffaf2;
      }
      code { font-family: inherit; }
    </style>
  </head>
  <body>
    <article>
      <h1>Session access requires the one-time open link</h1>
      <p>Use the original <code>/open/${escapeHtml(sessionId)}/&lt;token&gt;</code> link first so the gateway can exchange it for a signed session cookie.</p>
    </article>
  </body>
</html>`;
}
