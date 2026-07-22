import type {
  CompleteGitHubCheckRunInput,
  CreatePullRequestCheckRunInput,
  GitHubAppCheckRunClient,
} from "@boardreadyops/cloud-core/lifecycle-executor";

type PullRequestCommentInput = {
  installationId: number | string;
  repositoryOwner: string;
  repositoryName: string;
  pullRequestNumber: number;
  body: string;
};

type GitHubRequest = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type EnsurePullRequestCheckRunInput = {
  apiBaseUrl: string;
  token: string;
  input: CreatePullRequestCheckRunInput;
  request?: GitHubRequest;
};

export type UpsertReadinessCommentInput = {
  apiBaseUrl: string;
  token: string;
  repositoryOwner: string;
  repositoryName: string;
  pullRequestNumber: number;
  body: string;
  request?: GitHubRequest;
};

export type DurableGitHubAppCheckRunClient = GitHubAppCheckRunClient & {
  ensurePullRequestCheckRun(input: CreatePullRequestCheckRunInput): Promise<{ id: number }>;
  completeCheckRun(input: CompleteGitHubCheckRunInput): Promise<void>;
  createPullRequestComment?(input: PullRequestCommentInput): Promise<void>;
};

export declare function detailsUrl(runId: string): string | undefined;
export declare function ensurePullRequestCheckRun(input: EnsurePullRequestCheckRunInput): Promise<{ id: number }>;
export declare function upsertReadinessComment(input: UpsertReadinessCommentInput): Promise<void>;
export declare function createGitHubAppCheckRunClient(): DurableGitHubAppCheckRunClient | undefined;
