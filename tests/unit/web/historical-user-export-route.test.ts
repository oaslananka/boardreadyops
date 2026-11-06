import { beforeEach, describe, expect, it, vi } from "vitest";

const viewerAuthorization = vi.hoisted(() => vi.fn());
const config = vi.hoisted(() => vi.fn());
const createPgQueryExecutor = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({ viewerAuthorization }));
vi.mock("../../../apps/web/lib/cloud-runtime-config.js", () => ({ optionalCloudPersistenceConfiguration: config }));
vi.mock("@boardreadyops/db/pg-executor", () => ({ createPgQueryExecutor }));

import { GET } from "../../../apps/web/app/api/v1/historical-user-exports/[exportId]/route.js";

const exportId = "90d5910a-58c5-484b-a9c4-55e88279cc0f";
const baseURL = `https://boardreadyops.test/api/v1/historical-user-exports/${exportId}`;
const context = { params: Promise.resolve({ exportId }) };

function database(rows: Record<string, unknown>[], error?: Error) {
  const query = vi.fn().mockImplementation(() => (error ? Promise.reject(error) : Promise.resolve({ rows })));
  const close = vi.fn().mockResolvedValue(undefined);
  createPgQueryExecutor.mockReturnValue({ query, close });
  return { query, close };
}
const valid = {
  id: exportId,
  tenant_id: "historical-old-user",
  requested_by: "github_app_uninstall",
  status: "pending",
  scope: "user",
  scope_id: "historical-old-user",
  expires_at: null,
  created_at: new Date("2026-11-05T09:00:00Z"),
};

describe("read-only historical user export status after uninstall", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    viewerAuthorization.mockResolvedValue({
      session: { userId: 47291, login: "renamed-user", installationIds: [] },
    });
    config.mockReturnValue({ mode: "postgres", databaseUrl: "test-only" });
  });

  it("uses the signed immutable user ID, without requiring the removed installation or leaking the tenant", async () => {
    const { query, close } = database([valid]);
    const response = await GET(new Request(baseURL), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual({
      ok: true,
      export: {
        id: exportId,
        scope: "user",
        status: "pending",
        createdAt: "2026-11-05T09:00:00.000Z",
        expiresAt: null,
        downloadAvailable: false,
      },
    });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[1]).toEqual([exportId, 47291]);
    expect(query.mock.calls[0]?.[0]).toContain("original_github_user_id=$2::bigint");
    expect(query.mock.calls[0]?.[0]).toContain("erased.status='completed'");
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects missing identity, query-supplied authority, unsafe origins and malformed IDs before DB access", async () => {
    viewerAuthorization.mockResolvedValueOnce({ session: undefined });
    expect((await GET(new Request(baseURL), context)).status).toBe(401);
    expect((await GET(new Request(baseURL + "?installationId=old"), context)).status).toBe(400);
    expect((await GET(new Request(baseURL + "?download=archive"), context)).status).toBe(400);
    expect((await GET(new Request(baseURL + "?userId=47291"), context)).status).toBe(400);
    expect((await GET(new Request(baseURL, { headers: { range: "bytes=0-1" } }), context)).status).toBe(400);
    expect(
      (await GET(new Request(baseURL, { headers: { origin: "https://untrusted.example" } }), context)).status,
    ).toBe(403);
    expect((await GET(new Request(baseURL, { headers: { "sec-fetch-site": "cross-site" } }), context)).status).toBe(
      403,
    );
    expect((await GET(new Request(baseURL), { params: Promise.resolve({ exportId: "../escape" }) })).status).toBe(404);
    expect(createPgQueryExecutor).not.toHaveBeenCalled();
  });

  it("fails closed on identity mismatch, absent DB and backend errors", async () => {
    const missing = database([]);
    const denied = await GET(new Request(baseURL), context);
    expect(denied.status).toBe(404);
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
    expect(missing.close).toHaveBeenCalledOnce();

    config.mockReturnValueOnce(undefined);
    expect((await GET(new Request(baseURL), context)).status).toBe(503);

    const errored = database([], new Error("PG connection private detail"));
    const response = await GET(new Request(baseURL), context);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "Recovery status temporarily unavailable" });
    expect(errored.close).toHaveBeenCalledOnce();
  });
});
