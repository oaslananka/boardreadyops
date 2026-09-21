export interface MutationReport {
  files?: Record<string, { mutants?: Array<{ status: string }> }>;
}

export interface MutationMetrics {
  files: number;
  killed: number;
  timeout: number;
  survived: number;
  noCoverage: number;
  totalDetected: number;
  totalUndetected: number;
  totalValid: number;
  mutationScore: number;
}

export interface MutationThreshold {
  name: string;
  minimum: number;
  filePattern: string;
  matches(file: string): boolean;
}

export interface MutationThresholdResult extends MutationThreshold {
  metrics: MutationMetrics;
  passed: boolean;
}

export const defaultMutationThresholds: readonly MutationThreshold[];

export function normalizeFile(file: string): string;

export function calculateMutationMetrics(report: MutationReport, matches?: (file: string) => boolean): MutationMetrics;

export function checkMutationThresholds(
  report: MutationReport,
  thresholds?: readonly MutationThreshold[],
): MutationThresholdResult[];

export function formatMutationSummary(results: readonly MutationThresholdResult[]): string;

export function formatFailures(results: readonly MutationThresholdResult[]): string[];

export function expectedCoreMutationFiles(root?: string): Promise<string[]>;

export function missingMutationFiles(report: MutationReport, expectedFiles: readonly string[]): string[];

export function formatMissingMutationFiles(missingFiles: readonly string[], scope?: string): string[];

export function missingRequiredMutationFiles(report: MutationReport): string[];

export function main(argv?: string[], env?: NodeJS.ProcessEnv, root?: string): Promise<void>;

export function isTypeOnlySource(content: string): boolean;
export function isExecutableMutationFile(file: string, content?: string): boolean;
