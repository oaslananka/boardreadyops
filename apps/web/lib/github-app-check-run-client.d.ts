import type { GitHubAppCheckRunClient } from "@boardreadyops/cloud-core/lifecycle-executor";

type PullRequestCommentInput = {
  installationId: number | string;
  repositoryOwner: string;
  repositoryName: string;
  pullRequestNumber: number;
  body: string;
};

export declare function detailsUrl(runId: string): string | undefined;

export declare function createGitHubAppCheckRunClient():
  | (GitHubAppCheckRunClient & {
      createPullRequestComment?(input: PullRequestCommentInput): Promise<void>;
    })
  | undefined;
