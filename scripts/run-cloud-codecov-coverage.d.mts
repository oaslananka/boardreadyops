export interface CloudCoverageArgumentsOptions {
  readonly githubActions?: boolean;
}

export interface RunCloudCoverageOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly stdio?: "inherit" | "ignore" | "pipe";
}

export function buildCloudCoverageArguments(options?: CloudCoverageArgumentsOptions): string[];
export function runCloudCoverage(options?: RunCloudCoverageOptions): number;
