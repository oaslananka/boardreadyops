export interface SizePolicy {
  budget: number;
  failAtRatio: number;
}

export interface NpmPackResult {
  size: number;
  unpackedSize: number;
  [key: string]: unknown;
}

export function normalizeSizePolicy(
  policy: number | Partial<SizePolicy> | null | undefined,
  label?: string,
): SizePolicy;

export function parseNpmPackOutput(raw: string): NpmPackResult;

export function resolveNpmCliPath(
  nodeExecutable?: string,
  platform?: NodeJS.Platform,
  fileExists?: (path: string) => boolean,
): string;

export function formatChildProcessStderr(value: unknown): string;
