export type VerificationStatus = "tested" | "skipped" | "environment-dependent";

export interface VerificationStatusEntry {
  readonly status: VerificationStatus;
  readonly detail?: string;
}

export interface MonorepoIntegrationPlan {
  readonly requiredTests: string[];
  readonly postgresTests: string[];
  readonly databaseUrl?: string;
  readonly required: VerificationStatusEntry;
  readonly postgres: VerificationStatusEntry;
  readonly kicad: VerificationStatusEntry;
}

export interface BuildMonorepoIntegrationPlanOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly kicadAvailable?: boolean;
}

export interface RunMonorepoIntegrationOptions {
  readonly environment?: NodeJS.ProcessEnv;
}

export const TOOLCHAIN_DATABASE_URL: string;
export const REQUIRED_INTEGRATION_TESTS: readonly string[];
export const POSTGRES_INTEGRATION_TESTS: readonly string[];

export function isSupportedKicadVersion(version: string): boolean;
export function buildMonorepoIntegrationPlan(options?: BuildMonorepoIntegrationPlanOptions): MonorepoIntegrationPlan;
export function runMonorepoIntegration(options?: RunMonorepoIntegrationOptions): number;
