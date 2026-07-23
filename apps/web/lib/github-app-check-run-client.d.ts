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

export type GitHubCheckRunObservation =
  | { kind: "not_found" }
  | {
      kind: "present";
      name: string;
      externalId: string;
      headSha: string;
      status: string;
      conclusion?: string;
    };

export type ReadGitHubCheckRunInput = {
  apiBaseUrl: string;
  token: string;
  repositoryOwner: string;
  repositoryName: string;
  checkRunId: number | string;
  request?: GitHubRequest;
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

export type GitHubAppCheckRunClientResult = GitHubAppCheckRunClient & {
  readCheckRun?(input: {
    installationId: number | string;
    repositoryOwner: string;
    repositoryName: string;
    checkRunId: number | string;
  }): Promise<GitHubCheckRunObservation>;
  ensurePullRequestCheckRun?(input: CreatePullRequestCheckRunInput): Promise<{ id: number }>;
  completeCheckRun(input: CompleteGitHubCheckRunInput): Promise<void>;
  createPullRequestComment?(input: PullRequestCommentInput): Promise<void>;
};

export type DurableGitHubAppCheckRunClient = GitHubAppCheckRunClientResult & {
  ensurePullRequestCheckRun(input: CreatePullRequestCheckRunInput): Promise<{ id: number }>;
};

export declare const readinessCheckName = "BoardReadyOps / release readiness";
export declare function detailsUrl(runId: string): string | undefined;
export declare function readGitHubCheckRun(input: ReadGitHubCheckRunInput): Promise<GitHubCheckRunObservation>;
export declare function ensurePullRequestCheckRun(input: EnsurePullRequestCheckRunInput): Promise<{ id: number }>;
export declare function upsertReadinessComment(input: UpsertReadinessCommentInput): Promise<void>;
export declare function createGitHubAppCheckRunClient(): GitHubAppCheckRunClientResult | undefined;
