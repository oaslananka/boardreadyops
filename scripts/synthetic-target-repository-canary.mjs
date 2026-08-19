const repositoryPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
const branchPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;
const pathPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/u;
const workflowPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.ya?ml$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const defaultValues = {
  branch: "boardreadyops-canary",
  pullRequestTitle: "chore: BoardReadyOps synthetic canary",
  noncePath: "canary/nonce.txt",
  checkRunName: "BoardReadyOps / release readiness",
  readinessWorkflow: "readiness-runner.yml",
  timeoutSeconds: 1200,
  pollIntervalSeconds: 15,
  maxRequests: 256,
};

export class SyntheticCanaryError extends Error {
  constructor(reason, message, details = {}) {
    super(message);
    this.name = "SyntheticCanaryError";
    this.reason = reason;
    this.details = details;
  }
}

function required(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function positiveInteger(environment, name, fallback) {
  const raw = environment[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function validOrigin(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function safePath(value, name, pattern) {
  if (!pattern.test(value) || value.includes("..") || value.startsWith("/") || value.endsWith("/")) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

export function readSyntheticCanaryOptions(environment = process.env) {
  const repository = required(environment, "GITHUB_REPOSITORY");
  if (!repositoryPattern.test(repository)) throw new Error("GITHUB_REPOSITORY is invalid");
  const token = required(environment, "GITHUB_TOKEN");
  const runId = required(environment, "GITHUB_RUN_ID");
  const runAttempt = required(environment, "GITHUB_RUN_ATTEMPT");
  const visibility = required(environment, "BOARDREADYOPS_CANARY_VISIBILITY");
  if (visibility !== "public" && visibility !== "private") {
    throw new Error("BOARDREADYOPS_CANARY_VISIBILITY must be public or private");
  }
  const branch = safePath(
    environment.BOARDREADYOPS_CANARY_BRANCH ?? defaultValues.branch,
    "BOARDREADYOPS_CANARY_BRANCH",
    branchPattern,
  );
  const noncePath = safePath(
    environment.BOARDREADYOPS_CANARY_NONCE_PATH ?? defaultValues.noncePath,
    "BOARDREADYOPS_CANARY_NONCE_PATH",
    pathPattern,
  );
  const readinessWorkflow = environment.BOARDREADYOPS_CANARY_READINESS_WORKFLOW ?? defaultValues.readinessWorkflow;
  if (!workflowPattern.test(readinessWorkflow)) {
    throw new Error("BOARDREADYOPS_CANARY_READINESS_WORKFLOW is invalid");
  }
  const publicOrigin = required(environment, "BOARDREADYOPS_CANARY_PUBLIC_ORIGIN");
  if (!validOrigin(publicOrigin)) {
    throw new Error("BOARDREADYOPS_CANARY_PUBLIC_ORIGIN must be an HTTPS origin");
  }
  const timeoutSeconds = positiveInteger(
    environment,
    "BOARDREADYOPS_CANARY_TIMEOUT_SECONDS",
    defaultValues.timeoutSeconds,
  );
  const pollIntervalSeconds = positiveInteger(
    environment,
    "BOARDREADYOPS_CANARY_POLL_INTERVAL_SECONDS",
    defaultValues.pollIntervalSeconds,
  );
  const maxRequests = positiveInteger(environment, "BOARDREADYOPS_CANARY_MAX_REQUESTS", defaultValues.maxRequests);
  const checkRunName = environment.BOARDREADYOPS_CANARY_CHECK_RUN_NAME ?? defaultValues.checkRunName;
  const pullRequestTitle = environment.BOARDREADYOPS_CANARY_PULL_REQUEST_TITLE ?? defaultValues.pullRequestTitle;
  if (checkRunName.trim() === "" || checkRunName.length > 128) {
    throw new Error("BOARDREADYOPS_CANARY_CHECK_RUN_NAME is invalid");
  }
  if (pullRequestTitle.trim() === "" || pullRequestTitle.length > 256) {
    throw new Error("BOARDREADYOPS_CANARY_PULL_REQUEST_TITLE is invalid");
  }
  const apiBaseUrl = environment.GITHUB_API_URL ?? "https://api.github.com";
  if (!validOrigin(apiBaseUrl)) throw new Error("GITHUB_API_URL must be an HTTPS origin");
  return {
    repository,
    token,
    visibility,
    branch,
    pullRequestTitle,
    noncePath,
    checkRunName,
    readinessWorkflow,
    publicOrigin,
    apiBaseUrl,
    timeoutMs: timeoutSeconds * 1000,
    pollIntervalMs: pollIntervalSeconds * 1000,
    maxRequests,
    runId,
    runAttempt,
  };
}

function nowValue(now) {
  const value = now();
  return value instanceof Date ? value.getTime() : Number(value);
}

function createRuntime(options, dependencies = {}) {
  return {
    request: dependencies.request ?? fetch,
    sleep: dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    now: dependencies.now ?? (() => Date.now()),
    requestCount: 0,
    maxRequests: options.maxRequests,
  };
}

function requestHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  };
}

async function githubJson(runtime, options, operation, method, path, body, allowedStatuses = [200]) {
  if (runtime.requestCount >= runtime.maxRequests) {
    throw new SyntheticCanaryError("canary_github_api_unavailable", `${operation} exceeded the request limit`, {
      requestCount: runtime.requestCount,
    });
  }
  runtime.requestCount += 1;
  let response;
  try {
    response = await runtime.request(`${options.apiBaseUrl}${path}`, {
      method,
      headers: requestHeaders(options.token),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new SyntheticCanaryError("canary_github_api_unavailable", `${operation} request failed`, {
      requestCount: runtime.requestCount,
    });
  }
  if (!allowedStatuses.includes(response.status)) {
    throw new SyntheticCanaryError(
      "canary_github_api_unavailable",
      `${operation} failed with status ${response.status}`,
      {
        requestCount: runtime.requestCount,
        status: response.status,
      },
    );
  }
  const text = await response.text();
  if (text === "") return { status: response.status, value: {} };
  try {
    return { status: response.status, value: JSON.parse(text) };
  } catch {
    throw new SyntheticCanaryError("canary_github_api_unavailable", `${operation} returned invalid JSON`, {
      requestCount: runtime.requestCount,
      status: response.status,
    });
  }
}

function objectValue(value) {
  return typeof value === "object" && value !== null ? value : {};
}

function stringValue(value) {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function numberValue(value) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function repositoryParts(repository) {
  const [owner, name] = repository.split("/");
  return { owner, name };
}

function requireString(value, operation) {
  const result = stringValue(value);
  if (!result) {
    throw new SyntheticCanaryError("canary_pr_update_failed", `${operation} response was incomplete`);
  }
  return result;
}

async function updateWithRuntime(options, runtime) {
  const repositoryPath = `/repos/${options.repository}`;
  const repositoryResponse = await githubJson(runtime, options, "repository lookup", "GET", repositoryPath);
  const repository = objectValue(repositoryResponse.value);
  const expectedPrivate = options.visibility === "private";
  if (repository.full_name !== options.repository || repository.private !== expectedPrivate) {
    throw new SyntheticCanaryError("canary_pr_update_failed", "repository identity or visibility did not match", {
      repository: options.repository,
      visibility: options.visibility,
    });
  }
  const defaultBranch = requireString(repository.default_branch, "repository lookup");
  const defaultRef = await githubJson(
    runtime,
    options,
    "default branch lookup",
    "GET",
    `${repositoryPath}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
  );
  const defaultRefObject = objectValue(objectValue(defaultRef.value).object);
  const parentSha = requireString(defaultRefObject.sha, "default branch lookup");
  const parentCommit = await githubJson(
    runtime,
    options,
    "default commit lookup",
    "GET",
    `${repositoryPath}/git/commits/${encodeURIComponent(parentSha)}`,
  );
  const parentTree = objectValue(objectValue(parentCommit.value).tree);
  const parentTreeSha = requireString(parentTree.sha, "default commit lookup");
  const instant = new Date(nowValue(runtime.now));
  const nonce = `${instant.toISOString()}\nworkflow_run_id=${options.runId}\nworkflow_run_attempt=${options.runAttempt}\n`;
  const blob = await githubJson(
    runtime,
    options,
    "nonce blob creation",
    "POST",
    `${repositoryPath}/git/blobs`,
    {
      content: nonce,
      encoding: "utf-8",
    },
    [201, 200],
  );
  const blobSha = requireString(objectValue(blob.value).sha, "nonce blob creation");
  const tree = await githubJson(
    runtime,
    options,
    "nonce tree creation",
    "POST",
    `${repositoryPath}/git/trees`,
    {
      base_tree: parentTreeSha,
      tree: [{ path: options.noncePath, mode: "100644", type: "blob", sha: blobSha }],
    },
    [201, 200],
  );
  const treeSha = requireString(objectValue(tree.value).sha, "nonce tree creation");
  const commit = await githubJson(
    runtime,
    options,
    "nonce commit creation",
    "POST",
    `${repositoryPath}/git/commits`,
    {
      message: "chore: update BoardReadyOps synthetic canary",
      tree: treeSha,
      parents: [parentSha],
    },
    [201, 200],
  );
  const expectedSha = requireString(objectValue(commit.value).sha, "nonce commit creation");
  const canaryRefPath = `${repositoryPath}/git/ref/heads/${encodeURIComponent(options.branch)}`;
  const canaryRef = await githubJson(
    runtime,
    options,
    "canary branch lookup",
    "GET",
    canaryRefPath,
    undefined,
    [200, 404],
  );
  if (canaryRef.status === 404) {
    await githubJson(
      runtime,
      options,
      "canary branch creation",
      "POST",
      `${repositoryPath}/git/refs`,
      {
        ref: `refs/heads/${options.branch}`,
        sha: expectedSha,
      },
      [201],
    );
  } else {
    await githubJson(
      runtime,
      options,
      "canary branch update",
      "PATCH",
      `${repositoryPath}/git/refs/heads/${encodeURIComponent(options.branch)}`,
      { sha: expectedSha, force: true },
    );
  }
  const { owner } = repositoryParts(options.repository);
  const query = new URLSearchParams({
    state: "open",
    head: `${owner}:${options.branch}`,
    base: defaultBranch,
    per_page: "10",
  });
  const pulls = await githubJson(
    runtime,
    options,
    "canary pull request lookup",
    "GET",
    `${repositoryPath}/pulls?${query}`,
  );
  const pullRows = Array.isArray(pulls.value) ? pulls.value : [];
  let pullRequestNumber = numberValue(objectValue(pullRows[0]).number);
  if (!pullRequestNumber) {
    const created = await githubJson(
      runtime,
      options,
      "canary pull request creation",
      "POST",
      `${repositoryPath}/pulls`,
      {
        title: options.pullRequestTitle,
        head: options.branch,
        base: defaultBranch,
        body: "Automated BoardReadyOps target-repository synthetic canary.",
      },
      [201],
    );
    pullRequestNumber = numberValue(objectValue(created.value).number);
  }
  if (!pullRequestNumber) {
    throw new SyntheticCanaryError("canary_pr_update_failed", "pull request response was incomplete");
  }
  return { expectedSha, pullRequestNumber };
}

export async function updateSyntheticCanaryPullRequest(options, dependencies = {}) {
  return await updateWithRuntime(options, createRuntime(options, dependencies));
}

function sameOrigin(value, expectedOrigin) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === expectedOrigin;
  } catch {
    return false;
  }
}

function workflowRunIdFromSummary(summary, repository) {
  if (typeof summary !== "string" || !summary.includes("**Reports:**")) return undefined;
  const escaped = repository.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`https://github\\.com/${escaped}/actions/runs/(\\d+)`, "u").exec(summary);
  const value = match?.[1] ? Number(match[1]) : undefined;
  return Number.isSafeInteger(value) ? value : undefined;
}

function timeoutFailure(seenCheckRun, seenWorkflowRun) {
  if (seenWorkflowRun) return "canary_workflow_timeout";
  if (seenCheckRun) return "canary_check_run_timeout";
  return "canary_check_run_missing";
}

async function lookupCanaryCheckRun(options, expectedSha, runtime) {
  const checkQuery = new URLSearchParams({ check_name: options.checkRunName, filter: "all", per_page: "100" });
  const checkRuns = await githubJson(
    runtime,
    options,
    "Check Run lookup",
    "GET",
    `/repos/${options.repository}/commits/${expectedSha}/check-runs?${checkQuery}`,
  );
  const rows = Array.isArray(objectValue(checkRuns.value).check_runs) ? objectValue(checkRuns.value).check_runs : [];
  return rows.find((row) => {
    const checkRun = objectValue(row);
    return checkRun.name === options.checkRunName && checkRun.head_sha === expectedSha;
  });
}

function checkRunReleaseBinding(options, expectedSha, checkRunId, detail) {
  const releaseRunId = stringValue(detail.external_id);
  const detailsUrl = stringValue(detail.details_url);
  if (
    !releaseRunId ||
    !uuidPattern.test(releaseRunId) ||
    !detailsUrl ||
    !sameOrigin(detailsUrl, options.publicOrigin)
  ) {
    throw new SyntheticCanaryError("canary_check_run_binding_invalid", "Check Run release binding was invalid", {
      expectedSha,
      checkRunId,
      checkRunUrl: stringValue(detail.html_url),
    });
  }
  const workflowRunId = workflowRunIdFromSummary(objectValue(detail.output).summary, options.repository);
  if (!workflowRunId) {
    throw new SyntheticCanaryError("canary_workflow_missing", "readiness workflow link was not published", {
      expectedSha,
      checkRunId,
      checkRunUrl: stringValue(detail.html_url),
    });
  }
  return { releaseRunId, workflowRunId };
}

async function readCanaryCheckRun(options, expectedSha, runtime, match) {
  const checkRunId = numberValue(objectValue(match).id);
  if (!checkRunId) {
    throw new SyntheticCanaryError("canary_check_run_binding_invalid", "Check Run identifier was invalid", {
      expectedSha,
    });
  }
  const detailResponse = await githubJson(
    runtime,
    options,
    "Check Run detail lookup",
    "GET",
    `/repos/${options.repository}/check-runs/${checkRunId}`,
  );
  const detail = objectValue(detailResponse.value);
  if (detail.name !== options.checkRunName || detail.head_sha !== expectedSha) {
    throw new SyntheticCanaryError("canary_check_run_binding_invalid", "Check Run binding did not match", {
      expectedSha,
      checkRunId,
    });
  }
  if (detail.status !== "completed") return { status: "pending" };
  if (detail.conclusion !== "success") {
    throw new SyntheticCanaryError("canary_check_run_failed", "Check Run completed unsuccessfully", {
      expectedSha,
      checkRunId,
      checkRunUrl: stringValue(detail.html_url),
    });
  }
  const binding = checkRunReleaseBinding(options, expectedSha, checkRunId, detail);
  return { status: "completed", checkRunId, detail, ...binding };
}

function workflowRunMatches(options, workflowId, run) {
  return (
    objectValue(run.repository).full_name === options.repository &&
    run.event === "workflow_dispatch" &&
    run.workflow_id === workflowId
  );
}

async function readCanaryWorkflowRun(options, expectedSha, runtime, checkRun) {
  const workflow = await githubJson(
    runtime,
    options,
    "readiness workflow lookup",
    "GET",
    `/repos/${options.repository}/actions/workflows/${encodeURIComponent(options.readinessWorkflow)}`,
    undefined,
    [200, 404],
  );
  if (workflow.status === 404) {
    throw new SyntheticCanaryError("canary_workflow_missing", "readiness workflow was not found", {
      expectedSha,
      workflowRunId: checkRun.workflowRunId,
    });
  }
  const workflowId = numberValue(objectValue(workflow.value).id);
  if (!workflowId) {
    throw new SyntheticCanaryError("canary_workflow_missing", "readiness workflow identifier was invalid", {
      expectedSha,
      workflowRunId: checkRun.workflowRunId,
    });
  }
  const workflowRun = await githubJson(
    runtime,
    options,
    "readiness workflow run lookup",
    "GET",
    `/repos/${options.repository}/actions/runs/${checkRun.workflowRunId}`,
    undefined,
    [200, 404],
  );
  if (workflowRun.status === 404) {
    throw new SyntheticCanaryError("canary_workflow_missing", "readiness workflow run was not found", {
      expectedSha,
      workflowRunId: checkRun.workflowRunId,
    });
  }
  const run = objectValue(workflowRun.value);
  if (!workflowRunMatches(options, workflowId, run)) {
    throw new SyntheticCanaryError("canary_check_run_binding_invalid", "readiness workflow binding was invalid", {
      expectedSha,
      workflowRunId: checkRun.workflowRunId,
    });
  }
  if (run.status !== "completed") return { status: "pending" };
  const workflowUrl = stringValue(run.html_url);
  if (run.conclusion !== "success") {
    throw new SyntheticCanaryError("canary_workflow_failed", "readiness workflow completed unsuccessfully", {
      expectedSha,
      workflowRunId: checkRun.workflowRunId,
      workflowUrl,
    });
  }
  return { status: "completed", workflowUrl };
}

function verifiedCanaryResult(expectedSha, checkRun, workflowRun) {
  return {
    expectedSha,
    checkRunId: checkRun.checkRunId,
    ...(stringValue(checkRun.detail.html_url) ? { checkRunUrl: stringValue(checkRun.detail.html_url) } : {}),
    releaseRunId: checkRun.releaseRunId,
    workflowRunId: checkRun.workflowRunId,
    ...(workflowRun.workflowUrl ? { workflowUrl: workflowRun.workflowUrl } : {}),
  };
}

async function verifyWithRuntime(options, expectedSha, runtime) {
  const startedAt = nowValue(runtime.now);
  let seenCheckRun = false;
  let seenWorkflowRun = false;
  while (true) {
    const elapsedMs = nowValue(runtime.now) - startedAt;
    if (elapsedMs > options.timeoutMs) {
      throw new SyntheticCanaryError(timeoutFailure(seenCheckRun, seenWorkflowRun), "canary polling timed out", {
        expectedSha,
        elapsedMs,
      });
    }
    const match = await lookupCanaryCheckRun(options, expectedSha, runtime);
    if (!match) {
      const nextElapsed = nowValue(runtime.now) - startedAt;
      if (nextElapsed >= options.timeoutMs) {
        throw new SyntheticCanaryError("canary_check_run_missing", "Check Run was not observed", {
          expectedSha,
          elapsedMs: nextElapsed,
        });
      }
      await runtime.sleep(options.pollIntervalMs);
      continue;
    }
    seenCheckRun = true;
    const checkRun = await readCanaryCheckRun(options, expectedSha, runtime, match);
    if (checkRun.status === "pending") {
      await runtime.sleep(options.pollIntervalMs);
      continue;
    }
    const workflowRun = await readCanaryWorkflowRun(options, expectedSha, runtime, checkRun);
    seenWorkflowRun = true;
    if (workflowRun.status === "pending") {
      await runtime.sleep(options.pollIntervalMs);
      continue;
    }
    return verifiedCanaryResult(expectedSha, checkRun, workflowRun);
  }
}

export async function verifySyntheticCanary(options, expectedSha, dependencies = {}) {
  return await verifyWithRuntime(options, expectedSha, createRuntime(options, dependencies));
}

export async function runSyntheticCanary(options, dependencies = {}) {
  const startedAt = Date.now();
  const mutation = dependencies.mutation ?? updateSyntheticCanaryPullRequest;
  const verification = dependencies.verification ?? verifySyntheticCanary;
  const updated = await mutation(options, dependencies);
  const verified = await verification(options, updated.expectedSha, dependencies);
  return {
    ok: true,
    repository: options.repository,
    visibility: options.visibility,
    pullRequestNumber: updated.pullRequestNumber,
    ...verified,
    elapsedMs: Date.now() - startedAt,
  };
}
