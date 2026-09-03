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

export interface AuthenticatedRouteReport {
  route?: { path?: string };
  tasks?: { runLighthouseTask?: string };
  report?: {
    categories?: Record<string, { score?: number }>;
  };
}

export interface AuthenticatedUnlighthouseConfig {
  site: string;
  urls: string[];
  discovery: boolean;
  outputPath: string;
  cache: boolean;
  cookies: Array<{ name: string; value: string; domain: string; path: string }>;
  scanner: Record<string, unknown>;
  puppeteerClusterOptions: { maxConcurrency: number };
  puppeteerOptions: { headless: boolean };
  chrome: { useSystem: boolean; useDownloadFallback: boolean };
  lighthouseOptions: Record<string, unknown>;
  ci: { budget: Record<string, number>; buildStatic: boolean };
}

export interface AuthenticatedAuditResult {
  exitCode: number;
  manifest: AuthenticatedManifest;
  budgetFailures: Array<{ path: string; category: string; score: number; minimum: number }>;
  scanFailures?: Array<{ path: string; status: string }>;
  reportPath?: string;
}

export function parseAuthenticatedAuditOptions(
  environment?: NodeJS.ProcessEnv | Record<string, string | undefined>,
  argv?: string[],
): AuthenticatedAuditOptions;

export function buildAuthenticatedUnlighthouseConfig(input: {
  site: string;
  session: string;
  routes: string[];
  headful?: boolean;
}): AuthenticatedUnlighthouseConfig;
export function waitForWorkerCompletion(
  worker: {
    reports(): AuthenticatedRouteReport[];
    monitor?: () => { status: string };
  },
  expectedRoutes: string[],
  options?: {
    timeoutMs?: number;
    pollMs?: number;
    sleep?: (ms: number) => Promise<unknown>;
    now?: () => number;
  },
): Promise<AuthenticatedRouteReport[]>;

export function closeWorkerCluster(cluster: { display?: object | null; close(): Promise<void> }): Promise<void>;

export function runAuthenticatedAudit(options?: {
  environment?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  argv?: string[];
  discoverImpl?: (input: { site: string; session: string }) => Promise<AuthenticatedManifest>;
  writeManifestImpl?: (payload: string) => Promise<unknown>;
  coreImpl?: unknown;
}): Promise<AuthenticatedAuditResult>;
