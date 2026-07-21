export interface CodecovBundleConfig {
  readonly gitService?: string;
  readonly telemetry?: boolean;
  readonly retryCount?: number;
  readonly ignorePatterns?: string[];
  readonly normalizeAssetsPattern?: string;
}

export interface CodecovBundleOptionsInput {
  readonly uploadToken?: string;
  readonly dryRun?: boolean;
  readonly config?: CodecovBundleConfig;
}

export interface RunCodecovBundleAnalysisOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly stdout?: (value: string) => void;
}

export function buildCodecovBundleOptions(options?: CodecovBundleOptionsInput): {
  coreOptions: Record<string, unknown>;
  bundleAnalyzerOptions: Record<string, unknown>;
};
export function runCodecovBundleAnalysis(options?: RunCodecovBundleAnalysisOptions): Promise<string>;
