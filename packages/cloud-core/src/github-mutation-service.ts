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
  expectedBaseCommitSha?: string;
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

export interface ReadFileSnapshotInput {
  owner: string;
  repo: string;
  defaultBranch: string;
  path: string;
}

export interface RepositoryFileSnapshot {
  baseCommitSha: string;
  content: string;
}

export interface GitHubMutationService {
  readFileSnapshot(input: ReadFileSnapshotInput): Promise<RepositoryFileSnapshot>;
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

function validateMutationFiles(files: MutationFile[]): void {
  if (!files || files.length === 0) {
    throw new Error("mutation requires at least one file");
  }

  for (const file of files) {
    if (!isAllowedMutationPath(file.path)) {
      throw new Error(`path "${file.path}" is not in the allowed repository-mutation allowlist`);
    }
  }
}

async function resolveDefaultBranchCommitSha(
  client: GitHubMutationApiClient,
  repoPath: string,
  defaultBranch: string,
): Promise<string> {
  const defaultRefRes = await client.request<{ object: { sha: string } }>(
    `${repoPath}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
  );
  if (!defaultRefRes.ok || !defaultRefRes.data?.object?.sha) {
    throw new Error(`failed to resolve default branch "${defaultBranch}" commit SHA`);
  }
  return defaultRefRes.data.object.sha;
}

async function resolveBaseTreeSha(
  client: GitHubMutationApiClient,
  repoPath: string,
  defaultBranch: string,
  expectedBaseCommitSha?: string,
): Promise<{ baseCommitSha: string; baseTreeSha: string }> {
  const baseCommitSha = await resolveDefaultBranchCommitSha(client, repoPath, defaultBranch);
  if (expectedBaseCommitSha && expectedBaseCommitSha !== baseCommitSha) {
    throw new Error("default branch moved after repository snapshot; retry the mutation from the new base");
  }

  const baseCommitRes = await client.request<{ tree: { sha: string } }>(
    `${repoPath}/git/commits/${encodeURIComponent(baseCommitSha)}`,
  );
  if (!baseCommitRes.ok || !baseCommitRes.data?.tree?.sha) {
    throw new Error(`failed to resolve tree SHA for base commit "${baseCommitSha}"`);
  }
  return { baseCommitSha, baseTreeSha: baseCommitRes.data.tree.sha };
}

async function resolveBranchState(
  client: GitHubMutationApiClient,
  repoPath: string,
  branchName: string,
): Promise<{ branchExists: boolean; existingCommitSha?: string | undefined; existingTreeSha?: string | undefined }> {
  const targetBranchRefPath = branchName.split("/").map(encodeURIComponent).join("/");
  const targetRefRes = await client.request<{ object: { sha: string } }>(
    `${repoPath}/git/ref/heads/${targetBranchRefPath}`,
  );
  const branchExists = targetRefRes.status === 200 && Boolean(targetRefRes.data?.object?.sha);
  if (!branchExists) {
    return { branchExists: false };
  }

  const existingCommitSha = targetRefRes.data?.object?.sha;
  let existingTreeSha: string | undefined;
  if (existingCommitSha) {
    const commitRes = await client.request<{ tree: { sha: string } }>(
      `${repoPath}/git/commits/${encodeURIComponent(existingCommitSha)}`,
    );
    if (commitRes.ok && commitRes.data?.tree?.sha) {
      existingTreeSha = commitRes.data.tree.sha;
    }
  }
  return { branchExists: true, existingCommitSha, existingTreeSha };
}

async function resolveOpenPr(
  client: GitHubMutationApiClient,
  repoPath: string,
  owner: string,
  branchName: string,
  defaultBranch: string,
): Promise<{ number: number; html_url: string; title?: string; body?: string | null } | undefined> {
  const pullsRes = await client.request<
    Array<{ number: number; html_url: string; state: string; title?: string; body?: string | null }>
  >(
    `${repoPath}/pulls?head=${encodeURIComponent(owner)}:${encodeURIComponent(branchName)}&base=${encodeURIComponent(defaultBranch)}&state=open`,
  );
  if (pullsRes.ok && Array.isArray(pullsRes.data) && pullsRes.data.length > 0) {
    const first = pullsRes.data[0];
    if (first) {
      return {
        number: first.number,
        html_url: first.html_url,
        ...(first.title === undefined ? {} : { title: first.title }),
        ...(first.body === undefined ? {} : { body: first.body }),
      };
    }
  }
  return undefined;
}

async function updateOrCreateBranchRef(
  client: GitHubMutationApiClient,
  repoPath: string,
  branchName: string,
  branchExists: boolean,
  newCommitSha: string,
): Promise<void> {
  const targetBranchRefPath = branchName.split("/").map(encodeURIComponent).join("/");
  if (branchExists) {
    const updateRefRes = await client.request(`${repoPath}/git/refs/heads/${targetBranchRefPath}`, {
      method: "PATCH",
      body: JSON.stringify({
        sha: newCommitSha,
        force: false,
      }),
    });
    if (!updateRefRes.ok) {
      throw new Error(`failed to update branch ref "${branchName}"`);
    }
  } else {
    const createRefRes = await client.request(`${repoPath}/git/refs`, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: newCommitSha,
      }),
    });
    if (!createRefRes.ok) {
      throw new Error(`failed to create branch ref "${branchName}"`);
    }
  }
}

async function ensurePullRequest(
  client: GitHubMutationApiClient,
  repoPath: string,
  input: ExecuteMutationInput,
  existingPr: { number: number; html_url: string; title?: string; body?: string | null } | undefined,
): Promise<{ pullRequestNumber: number; pullRequestUrl: string; outcome: "created" | "updated" }> {
  if (existingPr) {
    if (existingPr.title !== input.prTitle || (existingPr.body ?? "") !== input.prBody) {
      const updatePrRes = await client.request(`${repoPath}/pulls/${existingPr.number}`, {
        method: "PATCH",
        body: JSON.stringify({ title: input.prTitle, body: input.prBody }),
      });
      if (!updatePrRes.ok) {
        throw new Error("failed to update pull request for mutation");
      }
    }
    return {
      pullRequestNumber: existingPr.number,
      pullRequestUrl: existingPr.html_url,
      outcome: "updated",
    };
  }

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
  return {
    pullRequestNumber: createPrRes.data.number,
    pullRequestUrl: createPrRes.data.html_url,
    outcome: "created",
  };
}

export function createGitHubMutationService(dependencies: GitHubMutationServiceDependencies): GitHubMutationService {
  const { client } = dependencies;

  return {
    async readFileSnapshot(input: ReadFileSnapshotInput): Promise<RepositoryFileSnapshot> {
      if (!isAllowedMutationPath(input.path)) {
        throw new Error(`path "${input.path}" is not in the allowed repository-mutation allowlist`);
      }
      const repoPath = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`;
      const baseCommitSha = await resolveDefaultBranchCommitSha(client, repoPath, input.defaultBranch);
      const encodedPath = input.path.split("/").map(encodeURIComponent).join("/");
      const fileRes = await client.request<{ encoding?: string; content?: string }>(
        `${repoPath}/contents/${encodedPath}?ref=${encodeURIComponent(baseCommitSha)}`,
      );
      if (!fileRes.ok || fileRes.data?.encoding !== "base64" || typeof fileRes.data.content !== "string") {
        throw new Error(`failed to read "${input.path}" from default branch snapshot`);
      }
      return {
        baseCommitSha,
        content: Buffer.from(fileRes.data.content, "base64").toString("utf8"),
      };
    },

    async execute(input: ExecuteMutationInput): Promise<MutationResult> {
      validateBranchName(input.branchName, input.defaultBranch);
      validateMutationFiles(input.files);

      const repoPath = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`;

      const { baseCommitSha, baseTreeSha } = await resolveBaseTreeSha(
        client,
        repoPath,
        input.defaultBranch,
        input.expectedBaseCommitSha,
      );
      const { branchExists, existingCommitSha, existingTreeSha } = await resolveBranchState(
        client,
        repoPath,
        input.branchName,
      );
      const existingPr = await resolveOpenPr(client, repoPath, input.owner, input.branchName, input.defaultBranch);

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

      if (branchExists && existingTreeSha === newTreeSha && existingPr) {
        const metadataMatches = existingPr.title === input.prTitle && (existingPr.body ?? "") === input.prBody;
        if (!metadataMatches) {
          await ensurePullRequest(client, repoPath, input, existingPr);
        }
        return {
          outcome: metadataMatches ? "already_exists" : "updated",
          branchName: input.branchName,
          commitSha: existingCommitSha as string,
          pullRequestNumber: existingPr.number,
          pullRequestUrl: existingPr.html_url,
        };
      }

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

      await updateOrCreateBranchRef(client, repoPath, input.branchName, branchExists, newCommitSha);
      const { pullRequestNumber, pullRequestUrl, outcome } = await ensurePullRequest(
        client,
        repoPath,
        input,
        existingPr,
      );

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
