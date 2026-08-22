import { createAppAuth } from "@octokit/auth-app";

export const readinessCheckName = "BoardReadyOps / release readiness";
const readinessCommentMarker = "<!-- boardreadyops:release-readiness -->";

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function githubPrivateKey() {
  return requiredEnv("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n");
}

export function detailsUrl(runId) {
  const baseUrl = process.env.BOARDREADYOPS_PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL;

  if (!baseUrl) {
    return undefined;
  }

  return `${baseUrl.replace(/\/$/, "")}/runs/${encodeURIComponent(runId)}`;
}

async function readJson(response, context) {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${context} failed with status ${response.status}: ${text.slice(0, 256)}`);
  }

  return text ? JSON.parse(text) : {};
}

function checkRunCollectionEndpoint(apiBaseUrl, owner, name) {
  return `${apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/check-runs`;
}

function commitCheckRunsEndpoint(apiBaseUrl, owner, name, commitSha) {
  return `${apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    name,
  )}/commits/${encodeURIComponent(commitSha)}/check-runs?check_name=${encodeURIComponent(
    readinessCheckName,
  )}&filter=all&per_page=100`;
}

function checkRunEndpoint(apiBaseUrl, owner, name, checkRunId) {
  return `${apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    name,
  )}/check-runs/${encodeURIComponent(String(checkRunId))}`;
}

function normalizedCheckRunState(value, fallback) {
  return typeof value === "string" && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(value) ? value : fallback;
}

function normalizedCheckRunBinding(value, fallback, maximumLength = 256) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength ? normalized : fallback;
}

export async function readGitHubCheckRun(input) {
  const request = input.request ?? fetch;
  const response = await request(
    checkRunEndpoint(input.apiBaseUrl, input.repositoryOwner, input.repositoryName, input.checkRunId),
    { method: "GET", headers: requestHeaders(input.token) },
  );
  if (response.status === 404) return { kind: "not_found" };
  if (!response.ok) throw new Error(`GitHub check run lookup failed with status ${response.status}`);
  const result = await response.json();
  const status = normalizedCheckRunState(result?.status, "unknown");
  const conclusion = result?.conclusion == null ? undefined : normalizedCheckRunState(result.conclusion, "unknown");
  return {
    kind: "present",
    name: normalizedCheckRunBinding(result?.name, "unknown"),
    externalId: normalizedCheckRunBinding(result?.external_id, "unknown"),
    headSha: normalizedCheckRunBinding(result?.head_sha, "unknown", 128),
    status,
    ...(conclusion ? { conclusion } : {}),
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

function issueCommentsEndpoint(apiBaseUrl, owner, name, issueNumber) {
  return `${apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    name,
  )}/issues/${encodeURIComponent(String(issueNumber))}/comments`;
}

function issueCommentEndpoint(apiBaseUrl, owner, name, commentId) {
  return `${apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    name,
  )}/issues/comments/${encodeURIComponent(String(commentId))}`;
}

function existingReadinessComment(comments) {
  if (!Array.isArray(comments)) {
    return undefined;
  }

  return comments.find((comment) => typeof comment?.body === "string" && comment.body.includes(readinessCommentMarker));
}

function existingReadinessCheckRun(result, runId) {
  const checkRuns = Array.isArray(result?.check_runs) ? result.check_runs : [];
  return checkRuns.find(
    (checkRun) =>
      checkRun?.name === readinessCheckName && checkRun?.external_id === runId && typeof checkRun?.id === "number",
  );
}

const queuedSafeModeReasonLabels = {
  "draft-pull-request": "Draft pull request",
  "fork-pull-request": "Fork pull request",
  "private-repository": "Private repository",
};

function queuedTrustSummary(action) {
  const safeMode = action.safeMode?.enabled === true;
  const reasons = (action.safeMode?.reasons ?? [])
    .flatMap((reason) => {
      const label = queuedSafeModeReasonLabels[reason];
      return typeof label === "string" ? [`${label} (\`${reason}\`)`] : [];
    })
    .join(" · ");
  const lines = [`Trust mode: ${safeMode ? "Safe (restricted)" : "Standard"}`, `Trust reasons: ${reasons || "None"}`];
  if (typeof action.baseCommitSha === "string" && /^[0-9a-f]{40}$/u.test(action.baseCommitSha)) {
    lines.push(`Impact base SHA: ${action.baseCommitSha}`);
  }
  if (safeMode && (action.pullRequestDraft === true || action.pullRequestFromFork === true)) {
    lines.push("Runner dispatch will be skipped; managed artifacts and result callback authority will not be granted.");
  } else if (safeMode) {
    lines.push("Applied restrictions: Managed evidence artifacts unavailable for this safe-mode execution");
  } else {
    lines.push("Applied restrictions: None");
  }
  return lines.join("\n");
}

function checkRunCreationBody(input) {
  const body = {
    name: readinessCheckName,
    head_sha: input.action.commitSha,
    status: "queued",
    external_id: input.runId,
    output: {
      title: "BoardReadyOps release readiness queued",
      summary: queuedTrustSummary(input.action),
    },
  };
  const url = detailsUrl(input.runId);

  if (url) {
    body.details_url = url;
  }

  return body;
}

export async function ensurePullRequestCheckRun(input) {
  const request = input.request ?? fetch;
  const headers = requestHeaders(input.token);
  const action = input.input.action;
  const existing = await readJson(
    await request(
      commitCheckRunsEndpoint(input.apiBaseUrl, action.repository.owner, action.repository.name, action.commitSha),
      { method: "GET", headers },
    ),
    "GitHub check run lookup",
  );
  const match = existingReadinessCheckRun(existing, input.input.runId);

  if (match) {
    return { id: match.id };
  }

  const created = await readJson(
    await request(checkRunCollectionEndpoint(input.apiBaseUrl, action.repository.owner, action.repository.name), {
      method: "POST",
      headers,
      body: JSON.stringify(checkRunCreationBody(input.input)),
    }),
    "GitHub check run creation",
  );

  if (typeof created.id !== "number") {
    throw new Error("GitHub check run response did not include a numeric id");
  }

  return { id: created.id };
}

export async function upsertReadinessComment(input) {
  const request = input.request ?? fetch;
  const headers = requestHeaders(input.token);
  const commentsUrl = issueCommentsEndpoint(
    input.apiBaseUrl,
    input.repositoryOwner,
    input.repositoryName,
    input.pullRequestNumber,
  );
  const comments = await readJson(
    await request(commentsUrl, {
      method: "GET",
      headers,
    }),
    "GitHub pull request comment lookup",
  );
  const existing = existingReadinessComment(comments);

  if (existing?.id) {
    await readJson(
      await request(issueCommentEndpoint(input.apiBaseUrl, input.repositoryOwner, input.repositoryName, existing.id), {
        method: "PATCH",
        headers,
        body: JSON.stringify({ body: input.body }),
      }),
      "GitHub pull request comment update",
    );
    return;
  }

  await readJson(
    await request(commentsUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ body: input.body }),
    }),
    "GitHub pull request comment creation",
  );
}

export function createGitHubAppCheckRunClient() {
  const appId = process.env.GITHUB_APP_ID;

  if (!appId || !process.env.GITHUB_APP_PRIVATE_KEY) {
    return undefined;
  }

  const apiBaseUrl = process.env.GITHUB_API_BASE_URL ?? "https://api.github.com";

  async function installationToken(installationId) {
    const auth = createAppAuth({
      appId,
      privateKey: githubPrivateKey(),
      installationId,
    });
    const installationAuth = await auth({ type: "installation" });
    return installationAuth.token;
  }

  async function ensure(input) {
    return ensurePullRequestCheckRun({
      apiBaseUrl,
      token: await installationToken(input.action.installation.id),
      input,
    });
  }

  return {
    async readCheckRun(input) {
      const token = await installationToken(input.installationId);
      return readGitHubCheckRun({
        apiBaseUrl,
        token,
        repositoryOwner: input.repositoryOwner,
        repositoryName: input.repositoryName,
        checkRunId: input.checkRunId,
      });
    },
    ensurePullRequestCheckRun: ensure,
    createPullRequestCheckRun: ensure,

    async completeCheckRun(input) {
      const token = await installationToken(input.installationId);
      const body = {
        status: "completed",
        conclusion: input.conclusion,
        completed_at: input.completedAt ?? new Date().toISOString(),
        output: {
          title: input.title,
          summary: input.summary,
        },
      };
      const url = detailsUrl(input.runId);

      if (url) {
        body.details_url = url;
      }

      await readJson(
        await fetch(checkRunEndpoint(apiBaseUrl, input.repositoryOwner, input.repositoryName, input.checkRunId), {
          method: "PATCH",
          headers: requestHeaders(token),
          body: JSON.stringify(body),
        }),
        "GitHub check run completion",
      );
    },

    async createPullRequestComment(input) {
      const token = await installationToken(input.installationId);
      await upsertReadinessComment({
        apiBaseUrl,
        token,
        repositoryOwner: input.repositoryOwner,
        repositoryName: input.repositoryName,
        pullRequestNumber: input.pullRequestNumber,
        body: input.body,
      });
    },
  };
}
