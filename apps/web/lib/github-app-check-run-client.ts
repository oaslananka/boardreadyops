import type { GitHubAppCheckRunClient } from "@boardreadyops/cloud-core/lifecycle-executor";
import { createAppAuth } from "@octokit/auth-app";

type GitHubTokenAuth = {
  token: string;
};

type GitHubCheckRunResponse = {
  id?: number;
};

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function githubPrivateKey(): string {
  return requiredEnv("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n");
}

function detailsUrl(runId: string): string | undefined {
  const baseUrl = process.env.BOARDREADYOPS_PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL;

  if (!baseUrl) {
    return undefined;
  }

  return `${baseUrl.replace(/\/$/, "")}/runs/${encodeURIComponent(runId)}`;
}

async function readJson<T>(response: Response, context: string): Promise<T> {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${context} failed with status ${response.status}: ${text.slice(0, 256)}`);
  }

  return text ? (JSON.parse(text) as T) : ({} as T);
}

export function createGitHubAppCheckRunClient(): GitHubAppCheckRunClient | undefined {
  const appId = process.env.GITHUB_APP_ID;

  if (!appId || !process.env.GITHUB_APP_PRIVATE_KEY) {
    return undefined;
  }

  const apiBaseUrl = process.env.GITHUB_API_BASE_URL ?? "https://api.github.com";

  return {
    async createPullRequestCheckRun(input) {
      const auth = createAppAuth({
        appId,
        privateKey: githubPrivateKey(),
        installationId: input.action.installation.id,
      });
      const installationAuth = (await auth({ type: "installation" })) as GitHubTokenAuth;
      const body: Record<string, unknown> = {
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
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${installationAuth.token}`,
            "content-type": "application/json",
            "x-github-api-version": "2022-11-28",
          },
          body: JSON.stringify(body),
        },
      );
      const json = await readJson<GitHubCheckRunResponse>(response, "GitHub check run creation");

      if (typeof json.id !== "number") {
        throw new Error("GitHub check run response did not include a numeric id");
      }

      return { id: json.id };
    },
  };
}
