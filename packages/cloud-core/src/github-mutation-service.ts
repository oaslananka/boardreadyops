export type RepositoryMutationIntent =
  | "release-preparation"
  | "remediation"
  | "setup"
  | "setup-update"
  | "waiver"
  | "workflow-upgrade";

export interface MutationFile {
  path: string;
  content: string;
}

export interface ExecuteMutationInput {
  installationId: number;
  owner: string;
  repo: string;
  defaultBranch: string;
  intent: RepositoryMutationIntent;
  branchName: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  files: MutationFile[];
  actorId?: string;
  requestId?: string;
}

export interface MutationResult {
  outcome: "already_exists" | "created" | "updated";
  branchName: string;
  commitSha: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  auditRecord?: {
    eventType: string;
    actorId?: string | undefined;
    details: Record<string, unknown>;
  };
}

export interface GitHubMutationApiClient {
  request<T = unknown>(path: string, init?: RequestInit): Promise<{ status: number; ok: boolean; data: T }>;
}

export interface GitHubMutationServiceDependencies {
  client: GitHubMutationApiClient;
}

export interface GitHubMutationService {
  execute(input: ExecuteMutationInput): Promise<MutationResult>;
}

const EXACT_ALLOWED_PATHS = new Set(["boardreadyops.yml", ".github/workflows/readiness-runner.yml"]);

const ALLOWED_DIR_PREFIX = ".boardreadyops/";

export function isAllowedMutationPath(filePath: string): boolean {
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.length > 500) {
    return false;
  }
  // Reject traversal, null bytes, backslashes, leading slash
  if (
    filePath.includes("\0") ||
    filePath.includes("\\") ||
    filePath.startsWith("/") ||
    filePath.split("/").includes("..") ||
    filePath.split("/").some((segment) => segment === "." || segment === "")
  ) {
    return false;
  }

  if (EXACT_ALLOWED_PATHS.has(filePath)) {
    return true;
  }

  if (filePath.startsWith(ALLOWED_DIR_PREFIX)) {
    return true;
  }

  return false;
}

const branchPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9._/-]{0,249})$/u;

function validateBranchName(branchName: string, defaultBranch: string): void {
  if (!branchPattern.test(branchName) || branchName.endsWith("/") || branchName.endsWith(".lock")) {
    throw new Error(`invalid branch name: "${branchName}"`);
  }
  if (
    branchName.includes("..") ||
    branchName.includes("~") ||
    branchName.includes("^") ||
    branchName.includes(":") ||
    branchName.includes("?") ||
    branchName.includes("*") ||
    branchName.includes("[") ||
    branchName.includes("@") ||
    branchName.includes("\\") ||
    branchName.includes(" ")
  ) {
    throw new Error(`invalid branch name: "${branchName}" contains disallowed characters`);
  }
  if (branchName === defaultBranch || branchName === "main" || branchName === "master" || branchName === "HEAD") {
    throw new Error(`cannot mutate default branch directly: "${branchName}"`);
  }
}

export function createGitHubMutationService(dependencies: GitHubMutationServiceDependencies): GitHubMutationService {
  const { client } = dependencies;

  return {
    async execute(input: ExecuteMutationInput): Promise<MutationResult> {
      validateBranchName(input.branchName, input.defaultBranch);

      if (!input.files || input.files.length === 0) {
        throw new Error("mutation requires at least one file");
      }

      for (const file of input.files) {
        if (!isAllowedMutationPath(file.path)) {
          throw new Error(`path "${file.path}" is not in the allowed repository-mutation allowlist`);
        }
      }

      const repoPath = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`;

      // 1. Get default branch commit SHA
      const defaultRefRes = await client.request<{ object: { sha: string } }>(
        `${repoPath}/git/ref/heads/${encodeURIComponent(input.defaultBranch)}`,
      );
      if (!defaultRefRes.ok || !defaultRefRes.data?.object?.sha) {
        throw new Error(`failed to resolve default branch "${input.defaultBranch}" commit SHA`);
      }
      const baseCommitSha = defaultRefRes.data.object.sha;

      // 2. Get base tree SHA from base commit
      const baseCommitRes = await client.request<{ tree: { sha: string } }>(
        `${repoPath}/git/commits/${encodeURIComponent(baseCommitSha)}`,
      );
      if (!baseCommitRes.ok || !baseCommitRes.data?.tree?.sha) {
        throw new Error(`failed to resolve tree SHA for base commit "${baseCommitSha}"`);
      }
      const baseTreeSha = baseCommitRes.data.tree.sha;

      // 3. Check if target branch already exists
      const targetBranchRefPath = input.branchName.split("/").map(encodeURIComponent).join("/");
      const targetRefRes = await client.request<{ object: { sha: string } }>(
        `${repoPath}/git/ref/heads/${targetBranchRefPath}`,
      );
      const branchExists = targetRefRes.status === 200 && Boolean(targetRefRes.data?.object?.sha);
      let existingCommitSha: string | undefined;
      let existingTreeSha: string | undefined;

      if (branchExists) {
        existingCommitSha = targetRefRes.data.object.sha;
        const existingCommitRes = await client.request<{ tree: { sha: string } }>(
          `${repoPath}/git/commits/${encodeURIComponent(existingCommitSha)}`,
        );
        if (existingCommitRes.ok && existingCommitRes.data?.tree?.sha) {
          existingTreeSha = existingCommitRes.data.tree.sha;
        }
      }

      // 4. Check for existing open pull request
      let existingPr: { number: number; html_url: string } | undefined;
      const pullsRes = await client.request<Array<{ number: number; html_url: string; state: string }>>(
        `${repoPath}/pulls?head=${encodeURIComponent(input.owner)}:${encodeURIComponent(input.branchName)}&base=${encodeURIComponent(input.defaultBranch)}&state=open`,
      );
      if (pullsRes.ok && Array.isArray(pullsRes.data) && pullsRes.data.length > 0) {
        const first = pullsRes.data[0];
        if (first) {
          existingPr = { number: first.number, html_url: first.html_url };
        }
      }

      // 5. Create new Git tree
      const treeItems = input.files.map((f) => ({
        path: f.path,
        mode: "100644",
        type: "blob",
        content: f.content,
      }));

      const newTreeRes = await client.request<{ sha: string }>(`${repoPath}/git/trees`, {
        method: "POST",
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeItems,
        }),
      });
      if (!newTreeRes.ok || !newTreeRes.data?.sha) {
        throw new Error("failed to create Git tree for mutation");
      }
      const newTreeSha = newTreeRes.data.sha;

      // 6. Idempotency check: if branch exists, tree is identical, and open PR exists -> return already_exists
      if (branchExists && existingTreeSha === newTreeSha && existingPr) {
        return {
          outcome: "already_exists",
          branchName: input.branchName,
          commitSha: existingCommitSha as string,
          pullRequestNumber: existingPr.number,
          pullRequestUrl: existingPr.html_url,
        };
      }

      // 7. Create Git commit
      const parentSha = branchExists && existingCommitSha ? existingCommitSha : baseCommitSha;
      const newCommitRes = await client.request<{ sha: string }>(`${repoPath}/git/commits`, {
        method: "POST",
        body: JSON.stringify({
          message: input.commitMessage,
          tree: newTreeSha,
          parents: [parentSha],
        }),
      });
      if (!newCommitRes.ok || !newCommitRes.data?.sha) {
        throw new Error("failed to create Git commit for mutation");
      }
      const newCommitSha = newCommitRes.data.sha;

      // 8. Create or update branch ref
      if (branchExists) {
        const updateRefRes = await client.request(`${repoPath}/git/refs/heads/${targetBranchRefPath}`, {
          method: "PATCH",
          body: JSON.stringify({
            sha: newCommitSha,
            force: false,
          }),
        });
        if (!updateRefRes.ok) {
          throw new Error(`failed to update branch ref "${input.branchName}"`);
        }
      } else {
        const createRefRes = await client.request(`${repoPath}/git/refs`, {
          method: "POST",
          body: JSON.stringify({
            ref: `refs/heads/${input.branchName}`,
            sha: newCommitSha,
          }),
        });
        if (!createRefRes.ok) {
          throw new Error(`failed to create branch ref "${input.branchName}"`);
        }
      }

      // 9. Create pull request if none exists, or use existing
      let pullRequestNumber: number;
      let pullRequestUrl: string;
      let outcome: "created" | "updated";

      if (existingPr) {
        pullRequestNumber = existingPr.number;
        pullRequestUrl = existingPr.html_url;
        outcome = "updated";
      } else {
        const createPrRes = await client.request<{ number: number; html_url: string }>(`${repoPath}/pulls`, {
          method: "POST",
          body: JSON.stringify({
            title: input.prTitle,
            body: input.prBody,
            head: input.branchName,
            base: input.defaultBranch,
          }),
        });
        if (!createPrRes.ok || !createPrRes.data?.number || !createPrRes.data?.html_url) {
          throw new Error("failed to open pull request for mutation");
        }
        pullRequestNumber = createPrRes.data.number;
        pullRequestUrl = createPrRes.data.html_url;
        outcome = "created";
      }

      const auditRecord = {
        eventType: "github.repository_mutation",
        actorId: input.actorId,
        details: {
          intent: input.intent,
          branchName: input.branchName,
          commitSha: newCommitSha,
          pullRequestNumber,
          filePaths: input.files.map((f) => f.path),
          requestId: input.requestId,
        },
      };

      return {
        outcome,
        branchName: input.branchName,
        commitSha: newCommitSha,
        pullRequestNumber,
        pullRequestUrl,
        auditRecord,
      };
    },
  };
}
