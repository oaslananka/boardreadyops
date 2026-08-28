import { statSync } from "node:fs";
import { isAbsolute } from "node:path";

function defaultIsRegularFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export interface ResolveGitExecutableOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  isRegularFile?: (filePath: string) => boolean;
}

/**
 * Safely resolves the absolute path to the git executable without relying on
 * untrusted PATH resolution, user-local directories, or unvalidated files.
 *
 * Checks in order:
 * 1. Explicit `BOARDREADYOPS_GIT_PATH` override (must be an existing absolute regular file).
 * 2. Fixed, non-user-writable system installation locations per platform.
 *
 * Throws an actionable error if no safe git binary is found.
 */
export function resolveGitExecutable(options: ResolveGitExecutableOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const checkFile = options.isRegularFile ?? defaultIsRegularFile;

  const override = env.BOARDREADYOPS_GIT_PATH;
  if (override !== undefined && override.trim() !== "") {
    const trimmed = override.trim();
    if (!isAbsolute(trimmed)) {
      throw new Error(`BOARDREADYOPS_GIT_PATH must be an absolute path, got: "${trimmed}"`);
    }
    if (!checkFile(trimmed)) {
      throw new Error(`BOARDREADYOPS_GIT_PATH does not point to an existing regular file: "${trimmed}"`);
    }
    return trimmed;
  }

  const candidates: string[] = [];

  if (platform === "win32") {
    candidates.push(
      String.raw`C:\Program Files\Git\cmd\git.exe`,
      String.raw`C:\Program Files\Git\bin\git.exe`,
      String.raw`C:\Program Files (x86)\Git\cmd\git.exe`,
      String.raw`C:\Program Files (x86)\Git\bin\git.exe`,
    );
  } else if (platform === "darwin") {
    candidates.push("/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git");
  } else {
    // Linux and other standard POSIX environments
    candidates.push("/usr/bin/git", "/usr/local/bin/git");
  }

  for (const candidate of candidates) {
    if (checkFile(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Safe git executable not found in standard system locations. " +
      "Set the BOARDREADYOPS_GIT_PATH environment variable to the absolute path of your git binary.",
  );
}
