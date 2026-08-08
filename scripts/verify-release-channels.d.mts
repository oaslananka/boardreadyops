export interface PublicReleaseFailure {
  name: string;
  details?: unknown;
}

export interface PublicReleaseSnapshot {
  version: string;
  expectedNodeEngines?: string;
  npm?: {
    version?: string;
    latest?: string;
    engines?: string;
  };
  release?: {
    tag?: string;
    draft?: boolean;
    prerelease?: boolean;
    commit?: string;
    assets?: Array<{ name: string; digest?: string }>;
  };
  floatingV1Commit?: string;
  checksumEntries?: Record<string, string>;
  downloadedAssetDigests?: Record<string, string>;
  ghcr?: {
    exact?: { digest?: string | null; platforms?: string[] };
    major?: { digest?: string | null; platforms?: string[] };
    latest?: { digest?: string | null; platforms?: string[] };
  };
  actionPins?: Array<{ path: string; sha: string; version: string }>;
  actionMetadataMatchesRelease?: boolean;
  formula?: { version?: string; digests?: string[] };
}

export function evaluatePublicReleaseSnapshot(snapshot: PublicReleaseSnapshot): PublicReleaseFailure[];

export function runReleaseChannelChecks(options?: {
  root?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<{ checks: string[]; failures: PublicReleaseFailure[] }>;
