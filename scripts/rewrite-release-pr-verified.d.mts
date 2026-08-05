export interface GitFileAddition {
  path: string;
  contents: string;
}

export interface GitFileDeletion {
  path: string;
}

export interface DesiredTreeChanges {
  baseOid: string;
  branchHeadOid: string;
  additions: GitFileAddition[];
  deletions: GitFileDeletion[];
}

export interface ReleaseBranchRewriteOptions extends DesiredTreeChanges {
  repository: string;
  branch: string;
  temporaryBranch: string;
  headline: string;
  body: string;
  token: string;
}

export interface VerifiedReleaseCommit {
  oid: string;
  verified: true;
  reason: string;
}

export function gitConfigNullDevice(platform?: NodeJS.Platform): string;

export function collectDesiredTreeChanges(root?: string, baseRef?: string): Promise<DesiredTreeChanges>;

export function rewriteReleaseBranchWithVerifiedCommit(
  options: ReleaseBranchRewriteOptions,
  fetchImpl?: typeof fetch,
): Promise<VerifiedReleaseCommit>;

export function main(root?: string, env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): Promise<VerifiedReleaseCommit>;
