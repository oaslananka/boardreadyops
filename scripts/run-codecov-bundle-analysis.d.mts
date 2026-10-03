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

export interface BundleAsset {
  name: string;
  size: number;
  gzipSize: number | null;
  normalized: string;
}

export function buildCodecovBundleOptions(options?: CodecovBundleOptionsInput): {
  coreOptions: Record<string, unknown>;
  bundleAnalyzerOptions: Record<string, unknown>;
};
export function collectBundleAssets(
  buildDirectoryPaths: string[],
  options?: { ignorePatterns?: string[]; normalizeAssetsPattern?: string },
): Promise<BundleAsset[]>;
export function createAndUploadBundleReport(
  buildDirectoryPaths: string[],
  coreOptions: Record<string, unknown>,
  bundleAnalyzerOptions?: Record<string, unknown>,
): Promise<string>;
export function runCodecovBundleAnalysis(options?: RunCodecovBundleAnalysisOptions): Promise<string>;
