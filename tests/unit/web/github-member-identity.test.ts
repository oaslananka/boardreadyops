import { describe, expect, it, vi } from "vitest";
import { resolveGitHubMemberIdentity } from "../../../apps/web/lib/github-member-identity.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GitHub workspace member identity resolution", () => {
  it("returns the stable GitHub identity and display metadata", async () => {
    const fetch = vi.fn(async () =>
      response({
        id: 583231,
        login: "octocat",
        name: "The Octocat",
        avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4",
        type: "User",
      }),
    );

    await expect(resolveGitHubMemberIdentity("OctoCat", { fetch: fetch as typeof globalThis.fetch })).resolves.toEqual({
      status: "resolved",
      identity: {
        githubUserId: 583231,
        login: "octocat",
        displayName: "The Octocat",
        avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
      },
    });
  });

  it("distinguishes a missing login from an unavailable lookup", async () => {
    const missing = vi.fn(async () => response({ message: "Not Found" }, 404));
    const unavailable = vi.fn(async () => response({ message: "rate limited" }, 403));

    await expect(
      resolveGitHubMemberIdentity("missing", { fetch: missing as typeof globalThis.fetch }),
    ).resolves.toEqual({
      status: "not_found",
    });
    await expect(
      resolveGitHubMemberIdentity("octocat", { fetch: unavailable as typeof globalThis.fetch }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("fails closed on transport or malformed responses", async () => {
    const broken = vi.fn(async () => {
      throw new Error("ETIMEDOUT");
    });
    const malformed = vi.fn(async () => response({ id: "583231", login: "octocat", type: "User" }));

    await expect(resolveGitHubMemberIdentity("octocat", { fetch: broken as typeof globalThis.fetch })).resolves.toEqual(
      {
        status: "unavailable",
      },
    );
    await expect(
      resolveGitHubMemberIdentity("octocat", { fetch: malformed as typeof globalThis.fetch }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("does not accept organizations as workspace member principals", async () => {
    const fetch = vi.fn(async () => response({ id: 1, login: "acme", type: "Organization" }));
    await expect(resolveGitHubMemberIdentity("acme", { fetch: fetch as typeof globalThis.fetch })).resolves.toEqual({
      status: "unsupported",
    });
  });
});
