export const CONTROL_PLANE_LOAD_CONFIRMATION: "isolated-disposable-database";

export type ControlPlaneLoadThresholds = {
  intakeP95Ms: number;
  lifecycleP95Ms: number;
  dashboardP95Ms: number;
  minimumThroughputPerSecond: number;
  recoveryMaxConvergenceMs: number;
};

export type ControlPlaneLoadConfiguration = {
  databaseUrl: string;
  profile: "representative" | "soak-recovery";
  recoveryRounds: number;
  uniqueDeliveries: number;
  duplicateDeliveries: number;
  repositoryCount: number;
  runsPerRepository: number;
  concurrency: number;
  thresholds: ControlPlaneLoadThresholds;
};

export type ControlPlaneLoadMeasurement = {
  count: number;
  elapsedMs: number;
  throughputPerSecond: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maximumMs: number;
};

export type ControlPlaneLoadRecoveryReport = {
  roundsRequested: number;
  roundsCompleted: number;
  jobLeaseRecoveries: number;
  staleJobCompletionsRejected: number;
  outboxRetries: number;
  uncertainOutboxQuarantines: number;
  delayedCallbackRepairs: number;
  staleAttemptResultsRejected: number;
  maximumConvergenceMs: number;
  deadLetters: number;
  ambiguousNonterminalStates: number;
};

export type ControlPlaneLoadReport = {
  event: "control_plane_load_verified";
  scenario: Omit<ControlPlaneLoadConfiguration, "databaseUrl" | "thresholds">;
  intake: ControlPlaneLoadMeasurement;
  lifecycle: ControlPlaneLoadMeasurement;
  dashboard: ControlPlaneLoadMeasurement;
  recovery?: ControlPlaneLoadRecoveryReport;
  signals: readonly string[];
  invariants: {
    acceptedDeliveries: number;
    duplicateDeliveries: number;
    completedJobs: number;
    releaseRuns: number;
    completedOutboxEffects: number;
    scopedDashboardReads: number;
    crossTenantMismatches: number;
  };
};

export function parseControlPlaneLoadConfiguration(
  environment?: Readonly<Record<string, string | undefined>>,
): ControlPlaneLoadConfiguration;
export function syntheticCommitSha(prefix: string, repositoryIndex: number, runIndex: number): string;
export function percentile(values: readonly number[], quantile: number): number;
export function summarizeDurations(values: readonly number[], elapsedMs: number): ControlPlaneLoadMeasurement;
export function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  operation: (value: Input, index: number) => Promise<Output>,
): Promise<Output[]>;
export function evaluateControlPlaneLoadReport(
  report: Omit<ControlPlaneLoadReport, "signals">,
  thresholds?: ControlPlaneLoadThresholds,
): string[];
export type ControlPlaneLoadDependencies = {
  createPgQueryExecutor: typeof import("../packages/db/src/pg-executor.js").createPgQueryExecutor;
  createSqlControlPlaneJobStore: typeof import("../packages/db/src/control-plane-job-store.js").createSqlControlPlaneJobStore;
  createSqlControlPlaneOutboxStore: typeof import("../packages/db/src/control-plane-outbox-store.js").createSqlControlPlaneOutboxStore;
  createSqlControlPlaneOperationsStore: typeof import("../packages/db/src/control-plane-operations-store.js").createSqlControlPlaneOperationsStore;
  createSqlRunnerLeaseStore: typeof import("../packages/db/src/runner-lease-store.js").createSqlRunnerLeaseStore;
  createSqlRunnerTerminalResultAuthorizer: typeof import("../packages/db/src/runner-terminal-result-store.js").createSqlRunnerTerminalResultAuthorizer;
  createSqlTransactionalGitHubAppLifecycleStore: typeof import("../packages/db/src/transactional-lifecycle-store.js").createSqlTransactionalGitHubAppLifecycleStore;
  processControlPlaneWorkflowReconciliation: typeof import("../apps/web/lib/control-plane-reconciliation-worker.js").processControlPlaneWorkflowReconciliation;
  lookupRunDashboard: typeof import("../apps/web/lib/run-dashboard.js").lookupRunDashboard;
};

export function runControlPlaneLoadValidation(
  configuration: ControlPlaneLoadConfiguration,
  dependencies: ControlPlaneLoadDependencies,
): Promise<ControlPlaneLoadReport>;
