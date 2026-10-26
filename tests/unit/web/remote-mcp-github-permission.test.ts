import { describe, expect, it, vi } from "vitest";

import {
  createLiveGitHubRepositoryAccess,
  createProductionLiveGitHubRepositoryAccess,
} from "../../../apps/web/lib/remote-mcp-github-permission.js";

const permission = {
  githubUserId: 123,
  githubRepositoryId: 456,
  githubInstallationId: 789,
  owner: "hardware-team",
  name: "design",
};
const json = (body: unknown, status = 200): Response => Response.json(body, { status });
function withResponses(...responses: Response[]) {
  const fetcher = vi.fn().mockImplementation(async () => responses.shift() ?? json({}, 404));
  const tokens = vi.fn().mockResolvedValue("fake-installation-token");
  const check = createLiveGitHubRepositoryAccess({
    createInstallationToken: tokens,
    fetcher,
    apiRoot: "https://api.github.com",
  });
  return { check, fetcher, tokens };
}

describe("live GitHub permission for remote MCP", () => {
  it("checks immutable user ID, repository ID and calculated user read permission", async () => {
    const { check, fetcher, tokens } = withResponses(
      json({ id: 123, login: "current-login" }),
      json({ id: 456 }),
      json({ permission: "read" }),
    );
    expect(await check(permission)).toBe(true);
    expect(tokens).toHaveBeenCalledWith(789);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      "https://api.github.com/user/123",
      "https://api.github.com/repos/hardware-team/design",
      "https://api.github.com/repos/hardware-team/design/collaborators/current-login/permission",
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init.redirect).toBe("error");
      expect(init.cache).toBe("no-store");
      expect(init.headers.authorization).toBe("Bearer fake-installation-token");
    }
  });

  it("denies removed collaborators even though the GitHub App installation still exists", async () => {
    const { check, fetcher } = withResponses(
      json({ id: 123, login: "current-login" }),
      json({ id: 456 }),
      json({ permission: "none" }),
    );
    expect(await check(permission)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("denies a replaced repository under the same owner/name", async () => {
    const { check, fetcher } = withResponses(json({ id: 123, login: "current-login" }), json({ id: 999 }));
    expect(await check(permission)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("denies a user ID/login mismatch instead of trusting an old GitHub handle", async () => {
    const { check, fetcher } = withResponses(json({ id: 999, login: "current-login" }));
    expect(await check(permission)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([404, 403, 429, 500])("denies GitHub API HTTP %s, including rate limits", async (status) => {
    const { check } = withResponses(json({ message: "unavailable" }, status));
    expect(await check(permission)).toBe(false);
  });

  it("denies unsafe request inputs before acquiring an installation token", async () => {
    const { check, tokens } = withResponses();
    expect(await check({ ...permission, githubUserId: 0 })).toBe(false);
    expect(await check({ ...permission, owner: "../secrets" })).toBe(false);
    expect(await check({ ...permission, name: "../secrets" })).toBe(false);
    expect(await check({ ...permission, name: ".." })).toBe(false);
    expect(await check({ ...permission, name: "." })).toBe(false);
    expect(tokens).not.toHaveBeenCalled();
  });

  it("fails closed on missing credentials, invalid API URL and network failure", async () => {
    const noCredentials = createProductionLiveGitHubRepositoryAccess({}, vi.fn());
    expect(await noCredentials(permission)).toBe(false);
    const badUrl = createProductionLiveGitHubRepositoryAccess(
      { GITHUB_APP_ID: "123", GITHUB_APP_PRIVATE_KEY: "not-a-key", GITHUB_API_BASE_URL: "http://unsafe" },
      vi.fn(),
    );
    expect(await badUrl(permission)).toBe(false);
    const broken = withResponses();
    broken.fetcher.mockRejectedValue(new Error("offline"));
    expect(await broken.check(permission)).toBe(false);
  });

  it("normalizes Doppler-style escaped GitHub App PEM before issuing an installation token", async () => {
    const mintToken = vi.fn().mockResolvedValue("synthetic-installation-token");
    const fetched = vi
      .fn()
      .mockResolvedValueOnce(json({ id: 123, login: "current-login" }))
      .mockResolvedValueOnce(json({ id: 456 }))
      .mockResolvedValueOnce(json({ permission: "read" }));
    const escapedPem = "fixture-header\\nsynthetic-key-material\\nfixture-footer";
    const check = createProductionLiveGitHubRepositoryAccess(
      {
        GITHUB_APP_ID: "123456",
        GITHUB_APP_PRIVATE_KEY: escapedPem,
        GITHUB_API_BASE_URL: "https://api.github.com",
      },
      fetched,
      mintToken,
    );
    const allowed = await check(permission);
    expect(mintToken, "GitHub App token issuer should be called").toHaveBeenCalledOnce();
    expect(fetched, "GitHub permission REST sequence").toHaveBeenCalledTimes(3);
    expect(allowed).toBe(true);
    expect(mintToken).toHaveBeenCalledWith("123456", "fixture-header\nsynthetic-key-material\nfixture-footer", 789);
    expect(fetched).toHaveBeenCalledTimes(3);
    for (const [, options] of fetched.mock.calls) {
      expect(options.headers.authorization).toBe("Bearer synthetic-installation-token");
      expect(options.redirect).toBe("error");
      expect(options.cache).toBe("no-store");
    }
  });

  it("refuses access if GitHub App installation-token issuance fails", async () => {
    const mintToken = vi.fn().mockRejectedValue(new Error("installation no longer active"));
    const fetched = vi.fn();
    const check = createProductionLiveGitHubRepositoryAccess(
      {
        GITHUB_APP_ID: "123456",
        GITHUB_APP_PRIVATE_KEY: "test-only-private-key",
      },
      fetched,
      mintToken,
    );
    expect(await check(permission)).toBe(false);
    expect(mintToken).toHaveBeenCalledOnce();
    expect(fetched).not.toHaveBeenCalled();
  });

  it("bounds UTF-8 response bytes, not only the shorter JavaScript character count", async () => {
    const oversizedUser = json({ id: 123, login: "current-login", padding: "é".repeat(40_000) });
    const { check, fetcher } = withResponses(oversizedUser, json({ id: 456 }), json({ permission: "read" }));
    expect(await check(permission)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("stops a chunked GitHub stream as soon as cumulative bytes exceed the 64 KiB cap", async () => {
    const prefix = new TextEncoder().encode(JSON.stringify({ id: 123, login: "current-login" }));
    const padding = new Uint8Array(64 * 1024 - prefix.byteLength);
    let cancelled = false;
    let returned = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        returned += 1;
        if (returned === 1) controller.enqueue(prefix);
        else if (returned === 2) controller.enqueue(padding);
        else controller.enqueue(new Uint8Array([120]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(stream, { status: 200 });
    const { check, fetcher } = withResponses(response, json({ id: 456 }), json({ permission: "read" }));
    expect(await check(permission)).toBe(false);
    expect(cancelled).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("checks actual UTF-8 bytes across chunks even with a lying small Content-Length", async () => {
    const encoded = new TextEncoder().encode(
      JSON.stringify({ id: 123, login: "current-login", padding: "é".repeat(40_000) }),
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.subarray(0, 26_000));
        controller.enqueue(encoded.subarray(26_000, 52_000));
        controller.enqueue(encoded.subarray(52_000));
        controller.close();
      },
    });
    const { check, fetcher } = withResponses(
      new Response(stream, { headers: { "content-length": "200" } }),
      json({ id: 456 }),
      json({ permission: "read" }),
    );
    expect(await check(permission)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("supports valid chunked GitHub JSON and rejects invalid UTF-8 without repository reads", async () => {
    const user = new TextEncoder().encode(JSON.stringify({ id: 123, login: "current-login" }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(user.subarray(0, 9));
        controller.enqueue(user.subarray(9));
        controller.close();
      },
    });
    const valid = withResponses(new Response(stream), json({ id: 456 }), json({ permission: "read" }));
    expect(await valid.check(permission)).toBe(true);
    expect(valid.fetcher).toHaveBeenCalledTimes(3);
    const invalidUser = withResponses(new Response(new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125])));
    expect(await invalidUser.check(permission)).toBe(false);
    expect(invalidUser.fetcher).toHaveBeenCalledTimes(1);
  });

  it("denies oversized responses and redirects instead of following URLs", async () => {
    const big = new Response("x".repeat(65_537), { status: 200 });
    const oversize = withResponses(big);
    expect(await oversize.check(permission)).toBe(false);
    const redirect = withResponses(new Response(null, { status: 302, headers: { location: "https://evil.test" } }));
    expect(await redirect.check(permission)).toBe(false);
  });
});
