import { describe, expect, it, vi } from "vitest";
import { handleProtectedReleaseIntent } from "../../../apps/web/lib/protected-release-intent-route.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";

const now = new Date("2026-10-13T11:00:00Z");
const repoId = "repo-123";
const session: UserSession = {
  userId: 701,
  login: "maintainer",
  installationIds: [501],
  issuedAt: "2026-10-13T10:00:00Z",
  expiresAt: "2026-10-13T18:00:00Z",
};
const environment = {
  SESSION_SECRET: "x".repeat(48),
  BOARDREADYOPS_PUBLIC_URL: "https://app.example.com",
};
const value = { sha: "a".repeat(40), requestId: "click-123456" };
const endpoint = "https://app.example.com/api/v1/repositories/repo-123/protected-release-intent";

function request(method: "GET" | "POST", csrf?: string, extraHeaders: Record<string, string> = {}): Request {
  return new Request(endpoint, {
    method,
    headers: {
      origin: "https://app.example.com",
      "content-type": "application/json",
      ...(csrf ? { "x-boardreadyops-csrf": csrf } : {}),
      ...extraHeaders,
    },
    ...(method === "POST" ? { body: JSON.stringify(value) } : {}),
  });
}

function deps(current: UserSession | undefined = session) {
  const record = vi.fn(async () => ({ id: "candidate-123", inserted: true }));
  const viewer = vi.fn(async () => ({ session: current }));
  return { record, viewer, now: () => now, environment };
}

describe("non-dispatching protected release intent API", () => {
  it("issues a session-bound CSRF token, then records only explicit validated intent", async () => {
    const setup = deps();
    const get = await handleProtectedReleaseIntent(request("GET"), repoId, setup);
    expect(get.status).toBe(200);
    expect(get.headers.get("cache-control")).toBe("no-store");
    const token = (await get.json()).csrfToken as string;
    const response = await handleProtectedReleaseIntent(request("POST", token), repoId, setup);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ candidateId: "candidate-123", inserted: true, dispatchAllowed: false });
    expect(setup.record).toHaveBeenCalledOnce();
    expect(setup.record).toHaveBeenCalledWith({ session, repositoryId: repoId, ...value });
  });

  it("rejects authorization bearer header even alongside a valid cookie/session", async () => {
    const setup = deps();
    const response = await handleProtectedReleaseIntent(
      request("GET", undefined, { authorization: "Bearer fake" }),
      repoId,
      setup,
    );
    expect(response.status).toBe(401);
    expect(setup.viewer).not.toHaveBeenCalled();
    expect(setup.record).not.toHaveBeenCalled();
  });

  it("rejects signed-out and expired sessions", async () => {
    const signedOut = deps();
    signedOut.viewer.mockResolvedValueOnce({ session: undefined });
    expect((await handleProtectedReleaseIntent(request("GET"), repoId, signedOut)).status).toBe(401);
    expect(
      (
        await handleProtectedReleaseIntent(
          request("GET"),
          repoId,
          deps({ ...session, expiresAt: "2026-10-13T10:59:00Z" }),
        )
      ).status,
    ).toBe(401);
  });

  it("rejects malformed session timestamps rather than minting an intent token", async () => {
    for (const corrupted of [
      { ...session, issuedAt: "not-a-date" },
      { ...session, expiresAt: "not-a-date" },
      { ...session, userId: 0 },
    ]) {
      const setup = deps(corrupted);
      expect((await handleProtectedReleaseIntent(request("GET"), repoId, setup)).status).toBe(401);
      expect(setup.record).not.toHaveBeenCalled();
    }
  });

  it("rejects no/mismatched CSRF, foreign origin and other repository without writing", async () => {
    const setup = deps();
    const get = await handleProtectedReleaseIntent(request("GET"), repoId, setup);
    const token = (await get.json()).csrfToken as string;
    expect((await handleProtectedReleaseIntent(request("POST"), repoId, setup)).status).toBe(403);
    expect((await handleProtectedReleaseIntent(request("POST", token), "repo-999", setup)).status).toBe(403);
    expect(
      (
        await handleProtectedReleaseIntent(
          request("POST", token, { origin: "https://evil.example.com" }),
          repoId,
          setup,
        )
      ).status,
    ).toBe(403);
    expect(setup.record).not.toHaveBeenCalled();
  });

  it("does not allow untrusted input to specify trust, run, or attempt", async () => {
    const setup = deps();
    const get = await handleProtectedReleaseIntent(request("GET"), repoId, setup);
    const token = (await get.json()).csrfToken as string;
    const custom = new Request(endpoint, {
      method: "POST",
      headers: { origin: "https://app.example.com", "content-type": "application/json", "x-boardreadyops-csrf": token },
      body: JSON.stringify({ ...value, trustMode: "protected", runId: "forged" }),
    });
    expect((await handleProtectedReleaseIntent(custom, repoId, setup)).status).toBe(400);
    expect(setup.record).not.toHaveBeenCalled();
  });

  it("fails closed on no live GitHub authorization, backend failures and unavailable secrets", async () => {
    const setup = deps();
    const token = (await (await handleProtectedReleaseIntent(request("GET"), repoId, setup)).json())
      .csrfToken as string;
    setup.record.mockResolvedValueOnce(undefined as never);
    expect((await handleProtectedReleaseIntent(request("POST", token), repoId, setup)).status).toBe(403);
    setup.record.mockRejectedValueOnce(new Error("database private"));
    const result = await handleProtectedReleaseIntent(request("POST", token), repoId, setup);
    expect(result.status).toBe(503);
    expect(JSON.stringify(await result.json())).not.toContain("database private");
    expect(
      (
        await handleProtectedReleaseIntent(request("POST", token), repoId, {
          ...setup,
          environment: { SESSION_SECRET: "short", BOARDREADYOPS_PUBLIC_URL: "https://app.example.com" },
        })
      ).status,
    ).toBe(503);
  });
});
