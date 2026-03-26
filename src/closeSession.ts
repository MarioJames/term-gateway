import type { CloseSessionResult, CloseTargetResult, SessionRecord } from "./types.js";
import { isCommandMissing, runTmuxCommand } from "./tmux.js";

export async function closeSessionResources(session: SessionRecord): Promise<CloseSessionResult> {
  const tmux = await safelyCloseTarget(() => closeTmuxSession(session.tmuxSession), {
    tmuxSession: session.tmuxSession
  });
  const requestedAt = new Date().toISOString();

  return {
    requestedAt,
    sessionId: session.id,
    registryStatus: "closed",
    registryUpdatedAt: requestedAt,
    tmux,
    summary: {
      closedAnyTarget: tmux.status === "closed",
      hasFailures: tmux.status === "failed"
    }
  };
}

async function safelyCloseTarget(
  action: () => Promise<CloseTargetResult>,
  fallbackDetails: Partial<CloseTargetResult>
): Promise<CloseTargetResult> {
  try {
    return await action();
  } catch (error) {
    return {
      target: "tmux",
      attempted: false,
      status: "failed",
      message: error instanceof Error ? error.message : "Unexpected close error",
      ...fallbackDetails
    };
  }
}

async function closeTmuxSession(tmuxSession: string): Promise<CloseTargetResult> {
  const trimmedSession = tmuxSession.trim();
  if (!trimmedSession) {
    return {
      target: "tmux",
      attempted: false,
      status: "skipped",
      message: "tmuxSession is empty; nothing to close."
    };
  }

  const hasSession = await runTmuxCommand(["has-session", "-t", trimmedSession]);
  if (hasSession.error) {
    return {
      target: "tmux",
      attempted: false,
      status: isCommandMissing(hasSession.error) ? "unsupported" : "failed",
      message: isCommandMissing(hasSession.error)
        ? "tmux is not installed on this host."
        : `Unable to inspect tmux session: ${hasSession.error.message}`,
      tmuxSession: trimmedSession,
      command: hasSession.command
    };
  }

  if (hasSession.exitCode === 1) {
    return {
      target: "tmux",
      attempted: false,
      status: "not_found",
      message: `tmux session ${trimmedSession} does not exist.`,
      tmuxSession: trimmedSession,
      command: hasSession.command
    };
  }

  if (hasSession.exitCode !== 0) {
    return {
      target: "tmux",
      attempted: false,
      status: "failed",
      message: formatCommandFailure("tmux has-session", hasSession),
      tmuxSession: trimmedSession,
      command: hasSession.command
    };
  }

  const killSession = await runTmuxCommand(["kill-session", "-t", trimmedSession]);
  if (killSession.error || killSession.exitCode !== 0) {
    return {
      target: "tmux",
      attempted: true,
      status: "failed",
      message: killSession.error
        ? `Unable to kill tmux session: ${killSession.error.message}`
        : formatCommandFailure("tmux kill-session", killSession),
      tmuxSession: trimmedSession,
      command: killSession.command
    };
  }

  return {
    target: "tmux",
    attempted: true,
    status: "closed",
    message: `tmux session ${trimmedSession} has been closed.`,
    tmuxSession: trimmedSession,
    command: killSession.command
  };
}

function formatCommandFailure(
  label: string,
  result: { stderr: string; exitCode: number | null }
): string {
  const stderr = result.stderr.trim();
  const suffix = stderr ? `: ${stderr}` : "";
  return `${label} exited with code ${result.exitCode ?? "unknown"}${suffix}`;
}
