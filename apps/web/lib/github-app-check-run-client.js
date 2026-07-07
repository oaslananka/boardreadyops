import { createAppAuth } from "@octokit/auth-app";

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

function detailsUrl(runId) {
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

function checkRunEndpoint(apiBaseUrl, owner, name, checkRunId) {
  return `${apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/check-runs/${encodeURIComponent(
    String(checkRunId),
  )}`;
}

function requestHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  };
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

  return {
    async createPullRequestCheckRun(input) {
      const token = await installationToken(input.action.installation.id);
      const body = {
        name: "BoardReadyOps / release readiness",
        head_sha: input.action.commitSha,
        status: "queued",
        external_id: input.runId,
      };
      const url = detailsUrl(input.runId);

      if (url) {
        body.details_url = url;
      }

      const response = await fetch(
        `${apiBaseUrl}/repos/${encodeURIComponent(input.action.repository.owner)}/${encodeURIComponent(
          input.action.repository.name,
        )}/check-runs`,
        {
          method: "POST",
          headers: requestHeaders(token),
          body: JSON.stringify(body),
        },
      );
      const json = await readJson(response, "GitHub check run creation");

      if (typeof json.id !== "number") {
        throw new Error("GitHub check run response did not include a numeric id");
      }

      return { id: json.id };
    },

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
  };
}
