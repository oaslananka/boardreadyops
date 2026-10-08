import { beforeEach, describe, expect, it, vi } from "vitest";

const viewerAuthorization = vi.hoisted(() => vi.fn());
const persistence = vi.hoisted(() => vi.fn());
const createPgQueryExecutor = vi.hoisted(() => vi.fn());

vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization,
}));
vi.mock("../../../apps/web/lib/cloud-runtime-config.js", () => ({
  resolveCloudPersistenceConfiguration: persistence,
}));
vi.mock("@boardreadyops/db/pg-executor", () => ({
  createPgQueryExecutor,
}));

import { POST } from "../../../apps/web/app/api/v1/erasure-requests/route.js";

function request(payload: unknown): Request {
  return new Request("https://boardreadyops.test/api/v1/erasure-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("erasure request scope boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewerAuthorization.mockResolvedValue({
      session: { userId: 42, login: "acme", installationIds: [10] },
    });
    persistence.mockReturnValue({ mode: "memory" });
  });

  it("rejects missing, blank and noncanonical scoped IDs before selecting any database", async () => {
    for (const scope of ["repository", "user"]) {
      for (const scopeId of [undefined, "", " ", " padded ", "\tvalue"]) {
        const response = await POST(request({ scope, scopeId }));
        expect(response.status).toBe(400);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        const result = (await response.json()) as { ok: boolean; issues: Array<{ path: string[] }> };
        expect(result.issues).toEqual([expect.objectContaining({ path: ["scopeId"] })]);
      }
    }
    expect(persistence).not.toHaveBeenCalled();
    expect(createPgQueryExecutor).not.toHaveBeenCalled();
  });

  it("rejects organization erasure IDs and unknown scopes before persistence", async () => {
    for (const payload of [
      { scope: "organization", scopeId: "" },
      { scope: "organization", scopeId: "repo-1" },
      { scope: "tenant", scopeId: "repo-1" },
    ]) {
      expect((await POST(request(payload))).status).toBe(400);
    }
    expect(persistence).not.toHaveBeenCalled();
    expect(createPgQueryExecutor).not.toHaveBeenCalled();
  });

  it("preserves accepted canonical scopes and requires authentication", async () => {
    for (const payload of [
      { scope: "organization" },
      { scope: "repository", scopeId: "repo-1" },
      { scope: "user", scopeId: "alice" },
    ]) {
      const response = await POST(request(payload));
      expect(response.status).toBe(503);
    }
    expect(persistence).toHaveBeenCalledTimes(3);
    expect(createPgQueryExecutor).not.toHaveBeenCalled();

    viewerAuthorization.mockResolvedValueOnce({ session: undefined });
    const unauthorized = await POST(request({ scope: "organization" }));
    expect(unauthorized.status).toBe(401);
    expect(persistence).toHaveBeenCalledTimes(3);
  });
});
