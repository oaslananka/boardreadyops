export interface CodecovCoverageArgumentsOptions {
  readonly githubActions?: boolean;
}

export interface RunCodecovCoverageOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly stdio?: "inherit" | "ignore" | "pipe";
}

export function buildCodecovCoverageArguments(options?: CodecovCoverageArgumentsOptions): string[];
export function runCodecovCoverage(options?: RunCodecovCoverageOptions): number;
