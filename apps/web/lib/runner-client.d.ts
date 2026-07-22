import type {
  DispatchReleaseRunWorkflowInput,
  EnqueueReleaseRunInput,
} from "@boardreadyops/cloud-core/lifecycle-executor";

export type RunnerSafeModeInputs = {
  safe_mode: "false" | "true";
  safe_mode_reasons: string;
};

export type RunnerDispatchInputs = RunnerSafeModeInputs & {
  run_id: string;
  execution_attempt_id: string;
  target: string;
  head_sha: string;
  result_url: string;
};

export type WorkflowDispatchResult = {
  workflowDispatchId: string;
  workflowRunUrl?: string;
};

export type DurableRunnerClient = {
  dispatchReleaseRunWorkflow(input: DispatchReleaseRunWorkflowInput): Promise<WorkflowDispatchResult>;
};

export declare function safeModeInputs(action: EnqueueReleaseRunInput): RunnerSafeModeInputs;
export declare function runnerDispatchInputs(input: DispatchReleaseRunWorkflowInput): RunnerDispatchInputs;
export declare function createRunnerClient(): DurableRunnerClient;
