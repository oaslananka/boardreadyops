export interface AuthenticatedAuditOptions {
  site: string;
  session: string;
  routesOnly: boolean;
  headful: boolean;
}

export interface AuthenticatedManifest {
  site: string;
  generatedAt: string;
  routes: string[];
}

export interface AuthenticatedLighthouseFlags {
  port: number;
  logLevel: string;
  output: string;
  onlyCategories: string[];
  disableStorageReset: boolean;
  formFactor: string;
  screenEmulation: { disabled: boolean };
  extraHeaders: { Cookie: string };
  throttlingMethod?: string;
}

export interface AuthenticatedAuditSummary {
  site: string;
  generatedAt: string;
  routes: Array<{
    path: string;
    scores: Record<string, number | null>;
  }>;
  scanFailures: Array<{ path: string; status: string }>;
  budgetFailures: Array<{ path: string; category: string; score: number; minimum: number }>;
}

export interface AuthenticatedAuditResult {
  exitCode: number;
  manifest: AuthenticatedManifest;
  budgetFailures: Array<{ path: string; category: string; score: number; minimum: number }>;
  scanFailures: Array<{ path: string; status: string }>;
  reportPath?: string;
}

export function parseAuthenticatedAuditOptions(
  environment?: NodeJS.ProcessEnv | Record<string, string | undefined>,
  argv?: string[],
): AuthenticatedAuditOptions;

export function buildAuthenticatedLighthouseFlags(input: {
  session: string;
  port: number;
  headful?: boolean;
}): AuthenticatedLighthouseFlags;

export function evaluateBudgetFailures(
  routeReports: Array<{ path: string; scores?: Record<string, number | null> }>,
): Array<{ path: string; category: string; score: number; minimum: number }>;

export function detectInstalledChrome(paths?: string[]): Promise<string | undefined>;

export function runAuthenticatedAudit(options?: {
  environment?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  argv?: string[];
  discoverImpl?: (input: { site: string; session: string }) => Promise<AuthenticatedManifest>;
  writeManifestImpl?: (payload: string) => Promise<unknown>;
  writeAuditSummaryImpl?: (summary: AuthenticatedAuditSummary) => Promise<unknown>;
  lighthouseImpl?: (url: string, flags: AuthenticatedLighthouseFlags) => Promise<{ lhr?: unknown } | undefined>;
  launchChromeImpl?: (options: {
    chromePath: string;
    chromeFlags: string[];
  }) => Promise<{ port: number; kill(): Promise<unknown> }>;
  detectChromeImpl?: () => Promise<string | undefined>;
}): Promise<AuthenticatedAuditResult>;
