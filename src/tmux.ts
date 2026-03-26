import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export interface TmuxCommandResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: Error;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 4_000;

const TMUX_CANDIDATES = [
  process.env.TMUX_BINARY,
  "/opt/homebrew/bin/tmux",
  "/usr/local/bin/tmux",
  "tmux"
].filter((value, index, array): value is string => Boolean(value) && array.indexOf(value as string) === index);

export async function runTmuxCommand(
  args: string[],
  options: { timeoutMs?: number } = {}
): Promise<TmuxCommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  let missingResult: TmuxCommandResult | null = null;

  for (const candidate of TMUX_CANDIDATES) {
    if (candidate.includes("/") && !existsSync(candidate)) {
      continue;
    }

    const result = await runCommand(candidate, args, timeoutMs);
    if (!result.error || !isCommandMissing(result.error)) {
      return result;
    }

    missingResult = result;
  }

  return (
    missingResult ?? {
      command: formatCommand("tmux", args),
      stdout: "",
      stderr: "",
      exitCode: null,
      error: Object.assign(new Error("tmux binary not found"), { code: "ENOENT" }) as Error
    }
  );
}

export function isCommandMissing(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function runCommand(command: string, args: string[], timeoutMs: number): Promise<TmuxCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);

    const finish = (result: TmuxCommandResult) => {
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

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}
