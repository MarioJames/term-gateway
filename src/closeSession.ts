import { spawn } from "node:child_process";

import type { CloseSessionResult, CloseTargetResult, SessionRecord } from "./types.js";

const COMMAND_TIMEOUT_MS = 4_000;
const PROCESS_EXIT_GRACE_MS = 1_500;
const PROCESS_EXIT_FORCE_MS = 500;
const DEFAULT_TTYD_PORT = 7681;
const LOCAL_TTYD_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

interface CommandResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: Error;
}

export async function closeSessionResources(session: SessionRecord): Promise<CloseSessionResult> {
  const [tmux, ttyd] = await Promise.all([
    safelyCloseTarget("tmux", () => closeTmuxSession(session.tmuxSession), {
      tmuxSession: session.tmuxSession
    }),
    safelyCloseTarget("ttyd", () => closeTtydProcess(session), {
      port: session.ttyd.port,
      upstreamUrl: session.ttyd.upstreamUrl
    })
  ]);

  const requestedAt = new Date().toISOString();

  return {
    requestedAt,
    sessionId: session.id,
    registryStatus: "closed",
    registryUpdatedAt: requestedAt,
    tmux,
    ttyd,
    summary: {
      closedAnyTarget: tmux.status === "closed" || ttyd.status === "closed",
      hasFailures: tmux.status === "failed" || ttyd.status === "failed"
    }
  };
}

async function safelyCloseTarget(
  target: "tmux" | "ttyd",
  action: () => Promise<CloseTargetResult>,
  fallbackDetails: Partial<CloseTargetResult>
): Promise<CloseTargetResult> {
  try {
    return await action();
  } catch (error) {
    return {
      target,
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

  const hasSession = await runCommand("tmux", ["has-session", "-t", trimmedSession]);
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

  const killSession = await runCommand("tmux", ["kill-session", "-t", trimmedSession]);
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

async function closeTtydProcess(session: SessionRecord): Promise<CloseTargetResult> {
  if (!session.ttyd.enabled) {
    return {
      target: "ttyd",
      attempted: false,
      status: "skipped",
      message: "ttyd is disabled for this session.",
      port: session.ttyd.port,
      upstreamUrl: session.ttyd.upstreamUrl
    };
  }

  const upstreamUrl = session.ttyd.upstreamUrl.trim();
  if (!upstreamUrl) {
    return {
      target: "ttyd",
      attempted: false,
      status: "unsupported",
      message: "ttyd upstream URL is not configured, so there is no reliable local process target to close.",
      port: session.ttyd.port,
      upstreamUrl: session.ttyd.upstreamUrl
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(upstreamUrl);
  } catch (error) {
    return {
      target: "ttyd",
      attempted: false,
      status: "unsupported",
      message: `Invalid ttyd upstream URL: ${error instanceof Error ? error.message : "unknown error"}`,
      port: session.ttyd.port,
      upstreamUrl: session.ttyd.upstreamUrl
    };
  }

  if (!LOCAL_TTYD_HOSTS.has(parsedUrl.hostname)) {
    return {
      target: "ttyd",
      attempted: false,
      status: "unsupported",
      message: `ttyd upstream host ${parsedUrl.hostname} is not local; refusing to guess which process to kill.`,
      port: session.ttyd.port,
      upstreamUrl: session.ttyd.upstreamUrl
    };
  }

  const port = Number.isInteger(session.ttyd.port) && session.ttyd.port > 0
    ? session.ttyd.port
    : Number.parseInt(parsedUrl.port || `${DEFAULT_TTYD_PORT}`, 10);

  const listProcesses = await runCommand("pgrep", ["-fal", "ttyd"]);
  if (listProcesses.error) {
    return {
      target: "ttyd",
      attempted: false,
      status: isCommandMissing(listProcesses.error) ? "unsupported" : "failed",
      message: isCommandMissing(listProcesses.error)
        ? "pgrep is not installed on this host."
        : `Unable to inspect ttyd processes: ${listProcesses.error.message}`,
      port,
      upstreamUrl: session.ttyd.upstreamUrl,
      command: listProcesses.command
    };
  }

  const ttydCandidates = parsePgrepOutput(listProcesses.stdout).filter((candidate) =>
    candidate.command.includes("ttyd") && !candidate.command.includes("pgrep -fal ttyd")
  );

  const portMatches = ttydCandidates.filter((candidate) => commandMatchesTtydPort(candidate.command, port));

  if (portMatches.length === 0) {
    return {
      target: "ttyd",
      attempted: false,
      status: "not_found",
      message: `No ttyd process with port ${port} could be identified from the local process table.`,
      port,
      upstreamUrl: session.ttyd.upstreamUrl,
      command: listProcesses.command
    };
  }

  if (portMatches.length > 1) {
    return {
      target: "ttyd",
      attempted: false,
      status: "unsupported",
      message: `Multiple ttyd processes match port ${port}; refusing to guess which one to kill.`,
      port,
      upstreamUrl: session.ttyd.upstreamUrl,
      command: listProcesses.command
    };
  }

  const matchedProcess = portMatches[0]!;
  try {
    process.kill(matchedProcess.pid, "SIGTERM");
  } catch (error) {
    return {
      target: "ttyd",
      attempted: true,
      status: "failed",
      message: `Unable to signal ttyd process ${matchedProcess.pid}: ${error instanceof Error ? error.message : "unknown error"}`,
      pid: matchedProcess.pid,
      port,
      upstreamUrl: session.ttyd.upstreamUrl,
      signal: "SIGTERM"
    };
  }

  const terminatedGracefully = await waitForProcessExit(matchedProcess.pid, PROCESS_EXIT_GRACE_MS);
  if (terminatedGracefully) {
    return {
      target: "ttyd",
      attempted: true,
      status: "closed",
      message: `ttyd process ${matchedProcess.pid} has been terminated with SIGTERM.`,
      pid: matchedProcess.pid,
      port,
      upstreamUrl: session.ttyd.upstreamUrl,
      signal: "SIGTERM"
    };
  }

  try {
    process.kill(matchedProcess.pid, "SIGKILL");
  } catch (error) {
    return {
      target: "ttyd",
      attempted: true,
      status: "failed",
      message: `ttyd process ${matchedProcess.pid} did not exit after SIGTERM and could not be force-killed: ${error instanceof Error ? error.message : "unknown error"}`,
      pid: matchedProcess.pid,
      port,
      upstreamUrl: session.ttyd.upstreamUrl,
      signal: "SIGTERM"
    };
  }

  const terminatedForcefully = await waitForProcessExit(matchedProcess.pid, PROCESS_EXIT_FORCE_MS);
  if (!terminatedForcefully) {
    return {
      target: "ttyd",
      attempted: true,
      status: "failed",
      message: `ttyd process ${matchedProcess.pid} is still alive after SIGTERM and SIGKILL.`,
      pid: matchedProcess.pid,
      port,
      upstreamUrl: session.ttyd.upstreamUrl,
      signal: "SIGKILL"
    };
  }

  return {
    target: "ttyd",
    attempted: true,
    status: "closed",
    message: `ttyd process ${matchedProcess.pid} required SIGKILL to stop.`,
    pid: matchedProcess.pid,
    port,
    upstreamUrl: session.ttyd.upstreamUrl,
    signal: "SIGKILL"
  };
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, COMMAND_TIMEOUT_MS);

    const finish = (result: CommandResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.on("error", (error) => {
      finish({
        command: formatCommand(command, args),
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: null,
        error
      });
    });

    child.on("close", (exitCode) => {
      finish({
        command: formatCommand(command, args),
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode
      });
    });
  });
}

function parsePgrepOutput(stdout: string): Array<{ pid: number; command: string }> {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) {
        return [];
      }

      return [
        {
          pid: Number.parseInt(match[1]!, 10),
          command: match[2]!
        }
      ];
    });
}

function commandMatchesTtydPort(command: string, port: number): boolean {
  const explicitPortPatterns = [
    new RegExp(`(?:^|\\s)-p\\s+${port}(?:\\s|$)`),
    new RegExp(`(?:^|\\s)--port\\s+${port}(?:\\s|$)`),
    new RegExp(`(?:^|\\s)-p=${port}(?:\\s|$)`),
    new RegExp(`(?:^|\\s)--port=${port}(?:\\s|$)`)
  ];

  return explicitPortPatterns.some((pattern) => pattern.test(command));
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function formatCommandFailure(label: string, result: CommandResult): string {
  const stderr = result.stderr.trim();
  const suffix = stderr ? `: ${stderr}` : "";
  return `${label} exited with code ${result.exitCode ?? "unknown"}${suffix}`;
}

function isCommandMissing(error: Error): boolean {
  return "code" in error && error.code === "ENOENT";
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }

    await sleep(100);
  }

  return !isProcessAlive(pid);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return false;
    }

    return true;
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
