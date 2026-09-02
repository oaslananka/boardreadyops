import { spawn } from "node:child_process";
import { join } from "node:path";

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

export interface ProcessOptions {
  cwd?: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  signal?: AbortSignal;
  /** Overrides the child's environment. Omit to inherit `process.env` (the default). */
  env?: NodeJS.ProcessEnv;
}

export function runProcess(command: string, args: string[], options: ProcessOptions = {}): Promise<ProcessResult> {
  if (options.signal?.aborted) {
    return Promise.reject(abortReason(options.signal));
  }
  return new Promise((resolveProcess, rejectProcess) => {
    const maxStdout = options.maxStdoutBytes ?? 1024 * 1024;
    const maxStderr = options.maxStderrBytes ?? 512 * 1024;
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const useCmdShim = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
    const commandLine = useCmdShim
      ? {
          command: trustedCmdExe(),
          args: ["/d", "/v:off", "/s", "/c", `"${buildCmdLine(command, args)}"`],
        }
      : { command, args };
    const child = spawn(commandLine.command, commandLine.args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      windowsVerbatimArguments: useCmdShim,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const requestTermination = () => {
      child.kill("SIGTERM");
      if (forceKillTimer) return;
      forceKillTimer = setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 500);
      forceKillTimer.unref();
    };
    const onAbort = () => {
      if (settled || aborted) return;
      aborted = true;
      requestTermination();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    const timer = setTimeout(() => {
      timedOut = true;
      requestTermination();
    }, options.timeoutMs ?? 30_000);
    timer.unref();

    const cleanup = () => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      options.signal?.removeEventListener("abort", onAbort);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk.toString("utf8"), maxStdout);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk.toString("utf8"), maxStderr);
    });
    const settle = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (aborted && options.signal) {
        rejectProcess(abortReason(options.signal));
        return;
      }
      resolveProcess(result);
    };
    child.on("error", (error) => {
      settle({ code: null, stdout, stderr, timedOut, error: error.message });
    });
    child.on("close", (code) => {
      settle({ code, stdout, stderr, timedOut });
    });
  });
}

function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function trustedCmdExe(): string {
  const systemRoot = process.env.SystemRoot;
  if (systemRoot && /^[a-z]:\\Windows$/i.test(systemRoot)) {
    return join(systemRoot, "System32", "cmd.exe");
  }
  return String.raw`C:\Windows\System32\cmd.exe`;
}

function buildCmdLine(command: string, args: string[]): string {
  return [quoteCmdToken(command), ...args.map(quoteCmdToken)].join(" ");
}

function quoteCmdToken(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  const sanitized = value.replace(/[\r\n]/g, "");
  return `"${sanitized.replaceAll('"', '""')}"`;
}

function appendBounded(current: string, next: string, limit: number): string {
  if (current.length >= limit) {
    return current;
  }
  const joined = current + next;
  if (joined.length <= limit) {
    return joined;
  }
  return `${joined.slice(0, limit)}\n[output truncated]`;
}
