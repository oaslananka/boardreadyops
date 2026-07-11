import type {
  DispatchReleaseRunWorkflowInput,
  EnqueueReleaseRunInput,
} from "@boardreadyops/cloud-core/lifecycle-executor";

export type RunnerSafeModeInputs = {
  safe_mode: "false" | "true";
  safe_mode_reasons: string;
};

export declare function safeModeInputs(action: EnqueueReleaseRunInput): RunnerSafeModeInputs;

export type RunnerDispatchInputs = RunnerSafeModeInputs & {
  run_id: string;
  execution_attempt_id: string;
  target: string;
  head_sha: string;
  result_url: string;
};

export declare function runnerDispatchInputs(input: DispatchReleaseRunWorkflowInput): RunnerDispatchInputs;

// biome-ignore lint/suspicious/noExplicitAny: Runtime JS client implements the cloud-core lifecycle interface.
export declare function createRunnerClient(): any;
