import type { GitHubAppCheckRunClient } from "@boardreadyops/cloud-core/lifecycle-executor";

type PullRequestCommentInput = {
  installationId: number | string;
  repositoryOwner: string;
  repositoryName: string;
  pullRequestNumber: number;
  body: string;
};

type ReadinessCommentRequest = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type UpsertReadinessCommentInput = {
  apiBaseUrl: string;
  token: string;
  repositoryOwner: string;
  repositoryName: string;
  pullRequestNumber: number;
  body: string;
  request?: ReadinessCommentRequest;
};

export declare function detailsUrl(runId: string): string | undefined;
export declare function upsertReadinessComment(input: UpsertReadinessCommentInput): Promise<void>;

export declare function createGitHubAppCheckRunClient():
  | (GitHubAppCheckRunClient & {
      createPullRequestComment?(input: PullRequestCommentInput): Promise<void>;
    })
  | undefined;
