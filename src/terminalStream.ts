import type { SessionRecord, TerminalSnapshot, TerminalSnapshotStatus } from "./types.js";
import { isCommandMissing, runTmuxCommand } from "./tmux.js";

const COMMAND_TIMEOUT_MS = 3_000;
const CAPTURE_SCROLLBACK_START = "-2000";

export interface TerminalStreamRouteMatch {
  sessionId: string;
}

export function matchTerminalStreamRoute(pathname: string): TerminalStreamRouteMatch | null {
  const match = pathname.match(/^\/api\/sessions\/([^/]+)\/stream\/?$/);
  if (!match) {
    return null;
  }

  return {
    sessionId: match[1]!
  };
}

export async function readTerminalSnapshot(session: SessionRecord): Promise<TerminalSnapshot> {
  if (session.status === "closed") {
    return createTerminalNoticeSnapshot("closed", "Session has been marked as closed.");
  }

  const captureResult = await capturePane(session.tmuxSession);

  if (captureResult.error) {
    return createTerminalNoticeSnapshot(
      isCommandMissing(captureResult.error) ? "unsupported" : "unavailable",
      isCommandMissing(captureResult.error)
        ? "tmux is not installed on this host."
        : `Unable to capture tmux pane: ${captureResult.error.message}`
    );
  }

  if (captureResult.exitCode !== 0) {
    return createTerminalNoticeSnapshot(
      "unavailable",
      captureResult.stderr.trim() || `tmux session ${session.tmuxSession} is not available.`
    );
  }

  const paneSize = await readPaneSize(session.tmuxSession);

  return {
    source: "tmux",
    status: "ok",
    message: null,
    content: normalizeTerminalContent(captureResult.stdout),
    capturedAt: new Date().toISOString(),
    rows: paneSize.rows,
    cols: paneSize.cols
  };
}

export function createTerminalNoticeSnapshot(
  status: Exclude<TerminalSnapshotStatus, "ok">,
  message: string
): TerminalSnapshot {
  return {
    source: "tmux",
    status,
    message,
    content: "",
    capturedAt: new Date().toISOString(),
    rows: null,
    cols: null
  };
}

async function readPaneSize(tmuxSession: string): Promise<{ rows: number | null; cols: number | null }> {
  const dimensionsResult = await runTmuxCommand(
    [
      "display-message",
      "-p",
      "-t",
      tmuxSession,
      "#{pane_width}\t#{pane_height}"
    ],
    { timeoutMs: COMMAND_TIMEOUT_MS }
  );

  if (dimensionsResult.error || dimensionsResult.exitCode !== 0) {
    return {
      rows: null,
      cols: null
    };
  }

  const [colsRaw, rowsRaw] = dimensionsResult.stdout.trim().split("\t");
  const cols = Number.parseInt(colsRaw ?? "", 10);
  const rows = Number.parseInt(rowsRaw ?? "", 10);

  return {
    rows: Number.isFinite(rows) ? rows : null,
    cols: Number.isFinite(cols) ? cols : null
  };
}

function normalizeTerminalContent(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n");
  return normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
}

async function capturePane(tmuxSession: string) {
  const alternateScreenResult = await runTmuxCommand(
    [
      "capture-pane",
      "-p",
      "-a",
      "-t",
      tmuxSession,
      "-S",
      CAPTURE_SCROLLBACK_START
    ],
    { timeoutMs: COMMAND_TIMEOUT_MS }
  );

  if (
    alternateScreenResult.error ||
    alternateScreenResult.exitCode === 0 ||
    !alternateScreenResult.stderr.includes("no alternate screen")
  ) {
    return alternateScreenResult;
  }

  return runTmuxCommand(
    [
      "capture-pane",
      "-p",
      "-t",
      tmuxSession,
      "-S",
      CAPTURE_SCROLLBACK_START
    ],
    { timeoutMs: COMMAND_TIMEOUT_MS }
  );
}
