import type { EnqueueReleaseRunInput } from "@boardreadyops/cloud-core/lifecycle-executor";

export type RunnerSafeModeInputs = {
  safe_mode: "false" | "true";
  safe_mode_reasons: string;
};

export declare function safeModeInputs(action: EnqueueReleaseRunInput): RunnerSafeModeInputs;

// biome-ignore lint/suspicious/noExplicitAny: Runtime JS client implements the cloud-core lifecycle interface.
export declare function createRunnerClient(): any;
