import { describe, expect, it, vi } from "vitest";
import { resolveLiveInstallationRepositoryIds } from "../../../apps/web/lib/live-installation-repositories.js";

const env = { GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: "test-app-private-key" };
const response = (ids: number[], total_count = ids.length, ok = true) =>
  new Response(JSON.stringify({ total_count, repositories: ids.map((id) => ({ id })) }), {
    status: ok ? 200 : 403,
    headers: { "content-type": "application/json" },
  });

describe("GitHub App live repository grants", () => {
  it("uses current selected repositories, not previously stored installation rows", async () => {
    const mintToken = vi.fn(async (id: number) => "token-" + id);
    const fetcher = vi.fn(async () => response([210]));
    const ids = await resolveLiveInstallationRepositoryIds([55], env, { mintToken, fetcher });
    expect(ids).toEqual([210]);
    expect(mintToken).toHaveBeenCalledExactlyOnceWith(55, env);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/installation/repositories?per_page=100&page=1",
      expect.objectContaining({
        redirect: "error",
        cache: "no-store",
        headers: expect.objectContaining({ authorization: "Bearer token-55" }),
      }),
    );
  });

  it("unions allowed repo IDs for multiple installations and paginates", async () => {
    const mintToken = vi.fn(async (id: number) => "token-" + id);
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      const token = String((init.headers as Record<string, string>).authorization);
      if (token === "Bearer token-8") return response([9001]);
      if (url.endsWith("page=1"))
        return response(
          Array.from({ length: 100 }, (_, i) => 1000 + i),
          101,
        );
      return response([1100], 101);
    });
    const result = await resolveLiveInstallationRepositoryIds([7, 8, 7], env, { mintToken, fetcher });
    expect(result).not.toBeNull();
    expect(result).toHaveLength(102);
    expect(result).toContain(1100);
    expect(result).toContain(9001);
    expect(mintToken).toHaveBeenCalledTimes(2);
  });

  it("fails closed on denied installs, API error or missing credentials", async () => {
    const mintToken = vi.fn(async () => "token");
    const denied = vi.fn(async () => response([], 0, false));
    expect(await resolveLiveInstallationRepositoryIds([55], env, { mintToken, fetcher: denied })).toBeNull();
    expect(
      await resolveLiveInstallationRepositoryIds([55], env, {
        mintToken,
        fetcher: vi.fn(async () => {
          throw new Error("private token");
        }),
      }),
    ).toBeNull();
    expect(
      await resolveLiveInstallationRepositoryIds(
        [55],
        { GITHUB_APP_ID: "123" },
        {
          mintToken,
          fetcher: denied,
        },
      ),
    ).toBeNull();
  });

  it("fails closed on incomplete pagination, malformed IDs and untrusted API roots", async () => {
    const mintToken = vi.fn(async () => "token");
    expect(
      await resolveLiveInstallationRepositoryIds([55], env, {
        mintToken,
        fetcher: vi.fn(async () => response([200], 3)),
      }),
    ).toBeNull();
    expect(
      await resolveLiveInstallationRepositoryIds([55], env, {
        mintToken,
        fetcher: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                total_count: 1,
                repositories: [{ id: "public-name-not-an-id" }],
              }),
              { status: 200 },
            ),
        ),
      }),
    ).toBeNull();
    expect(
      await resolveLiveInstallationRepositoryIds(
        [55],
        { ...env, GITHUB_API_BASE_URL: "https://other.example" },
        {
          mintToken,
          fetcher: vi.fn(async () => response([200])),
        },
      ),
    ).toBeNull();
  });

  it("returns an empty authorized list for an installation with zero selected repositories", async () => {
    const actual = await resolveLiveInstallationRepositoryIds([55], env, {
      mintToken: async () => "token",
      fetcher: async () => response([], 0),
    });
    expect(actual).toEqual([]);
  });
});
