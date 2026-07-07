export type RunnerMode = "github-actions" | "self-hosted" | "disabled";

export declare function runnerMode(): RunnerMode;

export declare function selfHostedRunnerLabel(): string;

export declare function selfHostedRunnerRequiresSafeMode(): boolean;

export declare function runnerModeSummary(): {
  mode: RunnerMode;
  selfHostedLabel: string;
  selfHostedRequiresSafeMode: boolean;
};
