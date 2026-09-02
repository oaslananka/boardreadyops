export function hashDistFiles(root: string, readFileImpl?: (path: string) => Promise<Uint8Array>): Promise<string>;

export function evaluateCleanRoomRebuild(digests: { sourceDigest?: string; cleanRoomDigest?: string }): {
  passed: boolean;
  reason: string;
};

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  allowFailure?: boolean;
}

export function runCleanRoomRebuild(options?: {
  root?: string;
  execImpl?: (command: string, args: string[], options?: ExecOptions) => ExecResult;
  mkdtempImpl?: (prefix: string) => Promise<string>;
  rmImpl?: (path: string, options: { recursive: boolean; force: boolean }) => Promise<void>;
  readFileImpl?: (path: string) => Promise<Uint8Array>;
  pnpmCli?: string | undefined;
  nodeExecutable?: string;
}): Promise<{
  passed: boolean;
  reason: string;
  commit: string;
  sourceDigest: string;
  cleanRoomDigest: string;
}>;
