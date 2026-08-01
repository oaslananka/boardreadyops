import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const graphqlUrl = "https://api.github.com/graphql";
const apiVersion = "2022-11-28";

export async function collectDesiredTreeChanges(root = process.cwd(), baseRef = "refs/remotes/origin/main") {
  const baseOid = (await git(root, "rev-parse", baseRef)).trim();
  const branchHeadOid = (await git(root, "rev-parse", "HEAD")).trim();
  const changed = splitNul(await git(root, "diff", "--name-only", "--diff-filter=ACMRTUXB", "-z", baseRef, "--"));
  const untracked = splitNul(await git(root, "ls-files", "--others", "--exclude-standard", "-z"));
  const deleted = splitNul(await git(root, "diff", "--name-only", "--diff-filter=D", "-z", baseRef, "--"));
  const deletionSet = new Set(deleted);
  const additionPaths = [...new Set([...changed, ...untracked])].filter((path) => !deletionSet.has(path)).sort();

  const additions = [];
  for (const path of additionPaths) {
    const absolutePath = resolveRepositoryPath(root, path);
    const stat = await lstat(absolutePath);
    if (!stat.isFile()) {
      throw new Error(`release rewrite only supports regular files: ${path}`);
    }
    additions.push({
      path,
      contents: (await readFile(absolutePath)).toString("base64"),
    });
  }

  return {
    baseOid,
    branchHeadOid,
    additions,
    deletions: deleted.sort().map((path) => ({ path })),
  };
}

export async function rewriteReleaseBranchWithVerifiedCommit(options, fetchImpl = globalThis.fetch) {
  const { repository, branch, temporaryBranch, branchHeadOid, baseOid, headline, body, additions, deletions, token } =
    options;
  assertRepository(repository);
  assertBranchName(branch, "branch");
  assertBranchName(temporaryBranch, "temporaryBranch");
  if (branch === temporaryBranch) {
    throw new Error("temporaryBranch must differ from branch");
  }
  assertNonEmpty(branchHeadOid, "branchHeadOid");
  assertNonEmpty(baseOid, "baseOid");
  assertNonEmpty(headline, "headline");
  assertNonEmpty(token, "token");
  if (!fetchImpl) {
    throw new Error("fetch implementation is required");
  }
  if (additions.length === 0 && deletions.length === 0) {
    throw new Error("refusing to rewrite a release branch with an empty diff");
  }

  const headers = githubHeaders(token);
  const currentHead = await getBranchHead(repository, branch, headers, fetchImpl);
  if (currentHead !== branchHeadOid) {
    throw new Error(`release branch moved: expected ${branchHeadOid}, found ${currentHead}`);
  }

  let temporaryBranchCreated = false;
  let operationError;
  let result;
  try {
    await requestJson(
      repositoryUrl(repository, "git/refs"),
      {
        method: "POST",
        headers,
        body: JSON.stringify({ ref: `refs/heads/${temporaryBranch}`, sha: baseOid }),
      },
      "temporary release branch creation",
      fetchImpl,
    );
    temporaryBranchCreated = true;

    const oid = await createVerifiedCommit(
      {
        repository,
        branch: temporaryBranch,
        expectedHeadOid: baseOid,
        headline,
        body,
        additions,
        deletions,
        headers,
      },
      fetchImpl,
    );

    const headBeforeRewrite = await getBranchHead(repository, branch, headers, fetchImpl);
    if (headBeforeRewrite !== branchHeadOid) {
      throw new Error(`release branch moved before rewrite: expected ${branchHeadOid}, found ${headBeforeRewrite}`);
    }

    await requestJson(
      repositoryUrl(repository, `git/refs/heads/${encodeRefName(branch)}`),
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ sha: oid, force: true }),
      },
      "release branch rewrite",
      fetchImpl,
    );

    const rewrittenHead = await getBranchHead(repository, branch, headers, fetchImpl);
    if (rewrittenHead !== oid) {
      throw new Error(`release branch rewrite did not converge: expected ${oid}, found ${rewrittenHead}`);
    }

    result = { oid, verified: true, reason: "valid" };
  } catch (error) {
    operationError = error;
  }

  if (temporaryBranchCreated) {
    try {
      await requestJson(
        repositoryUrl(repository, `git/refs/heads/${encodeRefName(temporaryBranch)}`),
        { method: "DELETE", headers },
        "temporary release branch cleanup",
        fetchImpl,
      );
    } catch (cleanupError) {
      if (operationError) {
        throw new AggregateError([operationError, cleanupError], "release rewrite and temporary branch cleanup failed");
      }
      throw cleanupError;
    }
  }

  if (operationError) {
    throw operationError;
  }
  return result;
}

export async function main(root = process.cwd(), env = process.env, fetchImpl = globalThis.fetch) {
  const repository = requireEnvironment(env, "REPO");
  const branch = requireEnvironment(env, "PR_BRANCH");
  const token = requireEnvironment(env, "GH_TOKEN");
  const runId = requireSafeIdentifier(env, "GITHUB_RUN_ID");
  const runAttempt = requireSafeIdentifier(env, "GITHUB_RUN_ATTEMPT");
  const baseRef = env.BASE_REF ?? "refs/remotes/origin/main";
  const temporaryBranch = `${branch}-verified-${runId}-${runAttempt}`;
  const changes = await collectDesiredTreeChanges(root, baseRef);
  const headline = env.RELEASE_COMMIT_HEADLINE ?? (await resolveReleaseHeadline(root, baseRef));
  const body = env.RELEASE_COMMIT_BODY ?? "Regenerated release and compliance artifacts.";

  const result = await rewriteReleaseBranchWithVerifiedCommit(
    {
      repository,
      branch,
      temporaryBranch,
      headline,
      body,
      token,
      ...changes,
    },
    fetchImpl,
  );
  process.stdout.write(`Rewrote ${branch} to GitHub-verified commit ${result.oid}.\n`);
  return result;
}

async function resolveReleaseHeadline(root, baseRef) {
  const subjects = (await git(root, "log", "--format=%s", "--reverse", `${baseRef}..HEAD`)).split("\n").filter(Boolean);
  const releaseSubject = subjects.find((subject) => /^chore\(main\): release\s+\S+/.test(subject));
  return releaseSubject ?? "chore(main): regenerate release pull request";
}

async function createVerifiedCommit(options, fetchImpl) {
  const response = await fetchImpl(graphqlUrl, {
    method: "POST",
    headers: options.headers,
    body: JSON.stringify({
      query: `mutation($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) {
    commit { oid }
  }
}`,
      variables: {
        input: {
          branch: {
            repositoryNameWithOwner: options.repository,
            branchName: options.branch,
          },
          message: {
            headline: options.headline,
            body: options.body,
          },
          expectedHeadOid: options.expectedHeadOid,
          fileChanges: {
            additions: options.additions,
            deletions: options.deletions,
          },
        },
      },
    }),
  });
  const payload = await readJsonResponse(response, "createCommitOnBranch");
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(`GitHub createCommitOnBranch failed: ${payload.errors.map((error) => error.message).join("; ")}`);
  }
  const oid = payload.data?.createCommitOnBranch?.commit?.oid;
  assertNonEmpty(oid, "created commit oid");

  const verification = await requestJson(
    repositoryUrl(options.repository, `commits/${encodeURIComponent(oid)}`),
    { headers: options.headers },
    "commit verification",
    fetchImpl,
  );
  const signature = verification.commit?.verification;
  if (signature?.verified !== true) {
    throw new Error(`GitHub did not verify commit ${oid}: ${signature?.reason ?? "unknown"}`);
  }
  return oid;
}

async function getBranchHead(repository, branch, headers, fetchImpl) {
  const payload = await requestJson(
    repositoryUrl(repository, `branches/${encodeURIComponent(branch)}`),
    { headers },
    "branch head lookup",
    fetchImpl,
  );
  const oid = payload.commit?.sha;
  assertNonEmpty(oid, "branch head oid");
  return oid;
}

async function requestJson(url, init, operation, fetchImpl) {
  const response = await fetchImpl(url, init);
  if (response.status === 204) {
    return null;
  }
  return readJsonResponse(response, operation);
}

async function readJsonResponse(response, operation) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`GitHub ${operation} returned invalid JSON (HTTP ${response.status})`);
  }
  if (!response.ok) {
    throw new Error(`GitHub ${operation} failed with HTTP ${response.status}: ${payload.message ?? text}`);
  }
  return payload;
}

async function git(root, ...args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
  });
  return Buffer.from(stdout).toString("utf8");
}

function splitNul(value) {
  return value.split("\0").filter(Boolean);
}

function resolveRepositoryPath(root, path) {
  if (!path || path.includes("\0")) {
    throw new Error("release rewrite returned an invalid repository path");
  }
  const resolvedRoot = resolve(root);
  const absolutePath = resolve(resolvedRoot, path);
  if (absolutePath !== resolvedRoot && !absolutePath.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`release rewrite path escapes the repository: ${path}`);
  }
  return absolutePath;
}

function repositoryUrl(repository, suffix) {
  return `https://api.github.com/repos/${repository.split("/").map(encodeURIComponent).join("/")}/${suffix}`;
}

function encodeRefName(branch) {
  return branch.split("/").map(encodeURIComponent).join("/");
}

function githubHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "user-agent": "boardreadyops-release-workflow",
    "x-github-api-version": apiVersion,
  };
}

function assertRepository(repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`invalid GitHub repository: ${repository}`);
  }
}

function assertBranchName(branch, label) {
  assertNonEmpty(branch, label);
  if (branch.startsWith("-") || branch.endsWith("/") || branch.includes("..") || branch.includes(" ")) {
    throw new Error(`invalid ${label}: ${branch}`);
  }
}

function assertNonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
}

function requireEnvironment(env, name) {
  const value = env[name];
  assertNonEmpty(value, name);
  return value;
}

function requireSafeIdentifier(env, name) {
  const value = requireEnvironment(env, name);
  if (!/^[A-Za-z0-9-]+$/.test(value)) {
    throw new Error(`${name} contains unsupported characters`);
  }
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
