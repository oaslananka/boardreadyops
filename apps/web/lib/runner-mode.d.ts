export type RunnerMode = "github-actions" | "self-hosted" | "disabled";
export type RunnerDispatch = "github-actions" | "self-hosted-queue" | "none";
export type RunnerConfigurationError = "invalid-runner-mode" | "invalid-self-hosted-label" | "invalid-safe-mode-flag";

export type RunnerConfiguration = {
  mode: RunnerMode;
  configurationValid: boolean;
  configurationError?: RunnerConfigurationError;
  dispatch: RunnerDispatch;
  selfHostedLabel: string;
  selfHostedRequiresSafeMode: boolean;
};

export declare function resolveRunnerConfiguration(
  environment?: Readonly<Record<string, string | undefined>>,
): RunnerConfiguration;
export declare function runnerMode(environment?: Readonly<Record<string, string | undefined>>): RunnerMode;
export declare function selfHostedRunnerLabel(environment?: Readonly<Record<string, string | undefined>>): string;
export declare function selfHostedRunnerRequiresSafeMode(
  environment?: Readonly<Record<string, string | undefined>>,
): boolean;
export declare function runnerModeSummary(
  environment?: Readonly<Record<string, string | undefined>>,
): RunnerConfiguration;
export declare function runnerWorkflowDispatchClient<T>(
  configuration: RunnerConfiguration,
  createClient: () => T,
): T | undefined;
