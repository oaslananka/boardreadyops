import { describe, expect, it, vi } from "vitest";
import {
  configuredGitHubOAuth,
  githubAuthorizeUrl,
  resolveGitHubUserIdentity,
} from "../../../apps/web/lib/github-user-access.js";

const configuration = { clientId: "Iv1.abc", clientSecret: "secret-value" };
const redirectUri = "https://cloud.example/api/auth/github/callback";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

function fetchStub(handlers: Record<string, () => Response>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const key = Object.keys(handlers).find((candidate) => url.startsWith(candidate));
    if (!key) throw new Error(`unexpected request to ${url}`);
    return handlers[key]?.() as Response;
  }) as unknown as typeof fetch;
}

describe("github user access", () => {
  it("requires both halves of the OAuth credential", () => {
    expect(configuredGitHubOAuth({ GITHUB_CLIENT_ID: "a", GITHUB_CLIENT_SECRET: "b" })).toEqual({
      clientId: "a",
      clientSecret: "b",
    });
    expect(configuredGitHubOAuth({ GITHUB_CLIENT_ID: "a" })).toBeUndefined();
    expect(configuredGitHubOAuth({ GITHUB_CLIENT_SECRET: "b" })).toBeUndefined();
    expect(configuredGitHubOAuth({})).toBeUndefined();
  });

  it("carries the state parameter into the authorize URL", () => {
    const url = new URL(githubAuthorizeUrl(configuration, redirectUri, "state-123"));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("Iv1.abc");
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(url.searchParams.get("state")).toBe("state-123");
  });

  it("resolves the viewer and every installation they can reach", async () => {
    const fetch = fetchStub({
      "https://github.com/login/oauth/access_token": () => jsonResponse({ access_token: "user-token" }),
      "https://api.github.com/user/installations": () => jsonResponse({ installations: [{ id: 1001 }, { id: 1002 }] }),
      "https://api.github.com/user": () => jsonResponse({ id: 4711, login: "octo-dev" }),
    });

    const identity = await resolveGitHubUserIdentity(configuration, "code", redirectUri, { fetch });

    expect(identity).toEqual({ userId: 4711, login: "octo-dev", installationIds: [1001, 1002] });
  });

  it("returns nothing when the code cannot be exchanged", async () => {
    const fetch = fetchStub({
      "https://github.com/login/oauth/access_token": () => jsonResponse({ error: "bad_verification_code" }),
    });

    await expect(resolveGitHubUserIdentity(configuration, "bad", redirectUri, { fetch })).resolves.toBeUndefined();
  });

  it("returns nothing when the viewer lookup fails rather than a partial identity", async () => {
    const fetch = fetchStub({
      "https://github.com/login/oauth/access_token": () => jsonResponse({ access_token: "user-token" }),
      "https://api.github.com/user": () => jsonResponse({}, false),
    });

    await expect(resolveGitHubUserIdentity(configuration, "code", redirectUri, { fetch })).resolves.toBeUndefined();
  });

  it("rejects a viewer payload that does not carry a usable identity", async () => {
    const fetch = fetchStub({
      "https://github.com/login/oauth/access_token": () => jsonResponse({ access_token: "user-token" }),
      "https://api.github.com/user": () => jsonResponse({ id: "4711", login: "octo-dev" }),
    });

    await expect(resolveGitHubUserIdentity(configuration, "code", redirectUri, { fetch })).resolves.toBeUndefined();
  });

  it("never sends the user token anywhere but GitHub", async () => {
    const calls: string[] = [];
    const stub = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://github.com/login/oauth/access_token")) {
        return jsonResponse({ access_token: "user-token" });
      }
      if (url.startsWith("https://api.github.com/user/installations")) return jsonResponse({ installations: [] });
      return jsonResponse({ id: 1, login: "a" });
    }) as unknown as typeof fetch;

    await resolveGitHubUserIdentity(configuration, "code", redirectUri, { fetch: stub });

    for (const url of calls) {
      expect(url).toMatch(/^https:\/\/(github\.com|api\.github\.com)\//u);
    }
  });

  it("refuses a partial identity when a later GitHub installations page fails", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/login/oauth/access_token")) return jsonResponse({ access_token: "user-token" });
      if (url.endsWith("/user")) return jsonResponse({ id: 4711, login: "octo-dev" });
      if (new URL(url).searchParams.get("page") === "1") {
        return jsonResponse({ installations: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })) });
      }
      if (new URL(url).searchParams.get("page") === "2") return jsonResponse({}, false);
      throw new Error(`unexpected request to ${url}`);
    }) as unknown as typeof fetch;

    await expect(resolveGitHubUserIdentity(configuration, "code", redirectUri, { fetch })).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("does not create a partial session when GitHub stops responding during pagination", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/login/oauth/access_token")) return jsonResponse({ access_token: "user-token" });
      if (url.endsWith("/user")) return jsonResponse({ id: 4711, login: "octo-dev" });
      if (new URL(url).searchParams.get("page") === "1") {
        return jsonResponse({ installations: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })) });
      }
      throw new Error("GitHub connection timed out");
    }) as unknown as typeof fetch;

    await expect(resolveGitHubUserIdentity(configuration, "code", redirectUri, { fetch })).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("retains every installation across successful GitHub pages", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/login/oauth/access_token")) return jsonResponse({ access_token: "user-token" });
      if (url.endsWith("/user")) return jsonResponse({ id: 4711, login: "octo-dev" });
      if (new URL(url).searchParams.get("page") === "1") {
        return jsonResponse({ installations: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })) });
      }
      if (new URL(url).searchParams.get("page") === "2")
        return jsonResponse({ installations: [{ id: 101 }, { id: 100 }] });
      throw new Error(`unexpected request to ${url}`);
    }) as unknown as typeof fetch;

    const identity = await resolveGitHubUserIdentity(configuration, "code", redirectUri, { fetch });
    expect(identity?.installationIds).toEqual(Array.from({ length: 101 }, (_, i) => i + 1));
  });

  it("refuses missing or malformed installation data instead of treating it as an empty account", async () => {
    for (const payload of [
      {},
      { installations: null },
      { installations: [{ id: "123" }] },
      { installations: [{ id: -1 }] },
    ]) {
      const fetch = fetchStub({
        "https://github.com/login/oauth/access_token": () => jsonResponse({ access_token: "user-token" }),
        "https://api.github.com/user/installations": () => jsonResponse(payload),
        "https://api.github.com/user": () => jsonResponse({ id: 4711, login: "octo-dev" }),
      });
      await expect(resolveGitHubUserIdentity(configuration, "code", redirectUri, { fetch })).resolves.toBeUndefined();
    }
  });

  it("refuses a truncated installation list at the configured pagination limit", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/login/oauth/access_token")) return jsonResponse({ access_token: "user-token" });
      if (url.endsWith("/user")) return jsonResponse({ id: 4711, login: "octo-dev" });
      if (url.includes("/user/installations")) {
        const page = Number(new URL(url).searchParams.get("page"));
        return jsonResponse({
          installations: Array.from({ length: 100 }, (_, i) => ({ id: (page - 1) * 100 + i + 1 })),
        });
      }
      throw new Error(`unexpected request to ${url}`);
    }) as unknown as typeof fetch;

    await expect(resolveGitHubUserIdentity(configuration, "code", redirectUri, { fetch })).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(12);
  });

  it("tolerates an account with no installations without failing sign-in", async () => {
    const fetch = fetchStub({
      "https://github.com/login/oauth/access_token": () => jsonResponse({ access_token: "user-token" }),
      "https://api.github.com/user/installations": () => jsonResponse({ installations: [] }),
      "https://api.github.com/user": () => jsonResponse({ id: 4711, login: "octo-dev" }),
    });

    const identity = await resolveGitHubUserIdentity(configuration, "code", redirectUri, { fetch });

    expect(identity).toEqual({ userId: 4711, login: "octo-dev", installationIds: [] });
  });
});
