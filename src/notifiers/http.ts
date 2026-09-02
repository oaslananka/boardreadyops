import type { Logger } from "../core/logger.js";

export type Fetcher = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface HttpNotifierDependencies {
  env?: Record<string, string | undefined> | undefined;
  fetcher?: Fetcher | undefined;
  logger?: Logger | undefined;
}

// webhookEnv is a repo-controlled config value (config.webhookEnv) naming an environment variable
// to read the actual webhook URL from. Nothing restricts that name, so a config change could point
// it at any env var present in the environment for an unrelated purpose. This is a naming
// convention check only -- it does not block delivery -- because a hard schema restriction is a
// breaking change per docs/architecture/contract-versioning.md (an existing config with a
// non-conforming name would silently fall back to the default config, disabling every notifier,
// not just webhooks). See docs/development/master-execution-status.json's W28 entry.
const webhookEnvNamePattern = /webhook/iu;

export function isRecognizedWebhookEnvName(name: string | undefined): boolean {
  return typeof name === "string" && webhookEnvNamePattern.test(name);
}

export function envValue(
  env: Record<string, string | undefined> | undefined,
  name: string | undefined,
): string | undefined {
  if (!name) {
    return undefined;
  }
  const value = (env ?? process.env)[name]?.trim();
  return value || undefined;
}

export async function postJson(fetcher: Fetcher | undefined, url: string, body: unknown): Promise<void> {
  const activeFetch = fetcher ?? globalThis.fetch;
  if (typeof activeFetch !== "function") {
    throw new Error("fetch is not available");
  }
  const response = await activeFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}
