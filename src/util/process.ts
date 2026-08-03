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
}

export function runProcess(command: string, args: string[], options: ProcessOptions = {}): Promise<ProcessResult> {
  return new Promise((resolveProcess) => {
    const maxStdout = options.maxStdoutBytes ?? 1024 * 1024;
    const maxStderr = options.maxStderrBytes ?? 512 * 1024;
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const useCmdShim = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
    const commandLine = useCmdShim
      ? {
          command: trustedCmdExe(),
          args: ["/d", "/v:off", "/s", "/c", `"${buildCmdLine(command, args)}"`],
        }
      : { command, args };
    const child = spawn(commandLine.command, commandLine.args, {
      cwd: options.cwd,
      windowsHide: true,
      windowsVerbatimArguments: useCmdShim,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 500).unref();
    }, options.timeoutMs ?? 30_000);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk.toString("utf8"), maxStdout);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk.toString("utf8"), maxStderr);
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveProcess({ code: null, stdout, stderr, timedOut, error: error.message });
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveProcess({ code, stdout, stderr, timedOut });
    });
  });
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
