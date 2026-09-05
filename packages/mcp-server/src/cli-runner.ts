import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CliRunner = (args: string[], cwd?: string) => Promise<CliRunResult>;

/**
 * Locates the installed `boardreadyops` package's CLI entrypoint via its own declared `bin`
 * field, rather than assuming a relative path into this monorepo -- this server spawns the CLI
 * exactly the way any other consumer of the published `boardreadyops` npm package would, so it
 * keeps working whether `@boardreadyops/mcp-server` runs from this workspace or as a separately
 * installed package with `boardreadyops` as a regular dependency.
 */
export function resolveCliEntrypoint(): string {
  const packageJsonUrl = import.meta.resolve("boardreadyops/package.json");
  const packageJsonPath = fileURLToPath(packageJsonUrl);
  const packageDir = path.dirname(packageJsonPath);
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { bin?: string | Record<string, string> };
  const binRelative = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.boardreadyops;
  if (!binRelative) {
    throw new Error("the boardreadyops package does not declare a 'boardreadyops' bin entry");
  }
  return path.join(packageDir, binRelative);
}

function sanitizeCliArgs(args: string[]): string[] {
  for (const arg of args) {
    if (typeof arg !== "string" || /[\0\r\n]/.test(arg)) {
      throw new Error(`Invalid CLI argument containing control characters: ${arg}`);
    }
  }
  return args;
}

/** Runs the `boardreadyops` CLI as a child process, exactly as a human would from a terminal. */
export function createCliRunner(entrypoint: string = resolveCliEntrypoint()): CliRunner {
  return (args, cwd) =>
    new Promise((resolve, reject) => {
      const sanitizedArgs = sanitizeCliArgs(args);
      const child = spawn(process.execPath, [entrypoint, ...sanitizedArgs], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });
}
