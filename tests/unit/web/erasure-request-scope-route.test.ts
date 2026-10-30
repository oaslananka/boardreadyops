import { beforeEach, describe, expect, it, vi } from "vitest";

const viewerAuthorization = vi.hoisted(() => vi.fn());
const persistence = vi.hoisted(() => vi.fn());
const createPgQueryExecutor = vi.hoisted(() => vi.fn());
const resolveTenant = vi.hoisted(() => vi.fn());

vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization,
}));
vi.mock("../../../apps/web/lib/cloud-runtime-config.js", () => ({
  resolveCloudPersistenceConfiguration: persistence,
}));
vi.mock("@boardreadyops/db/pg-executor", () => ({
  createPgQueryExecutor,
}));
vi.mock("../../../apps/web/lib/settings-tenant.js", () => ({ resolveSettingsTenantScope: resolveTenant }));

import { POST as postExport } from "../../../apps/web/app/api/v1/data-exports/route.js";
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

describe("shared lifecycle request transport boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewerAuthorization.mockResolvedValue({
      session: { userId: 42, login: "acme", installationIds: [10] },
    });
    persistence.mockReturnValue({ mode: "memory" });
    resolveTenant.mockResolvedValue({
      selected: { id: "inst-a", accountLogin: "acme" },
      installations: [{ id: "inst-a", accountLogin: "acme" }],
    });
  });

  it("records bounded export and erasure intake and closes the database executor", async () => {
    persistence.mockReturnValue({ mode: "postgres", databaseUrl: "postgres://invalid.test/mock" });
    const query = vi.fn().mockImplementation(async (_statement: string, values: readonly unknown[]) => ({
      rows: [
        {
          id: "record-1",
          tenant_id: values[1],
          requested_by: values[2],
          status: "pending",
          scope: values[3],
          scope_id: values[4],
          dry_run: false,
          created_at: new Date("2026-10-30T00:00:00Z"),
        },
      ],
    }));
    const close = vi.fn().mockResolvedValue(undefined);
    createPgQueryExecutor.mockReturnValue({ query, close });

    const exportResponse = await postExport(request({ installationId: "inst-a", scope: "organization" }));
    expect(exportResponse.status).toBe(201);
    expect(exportResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(await exportResponse.json()).toMatchObject({ ok: true, exportId: "record-1", status: "pending" });

    const erasureResponse = await POST(request({ installationId: "inst-a", scope: "organization" }));
    expect(erasureResponse.status).toBe(201);
    expect(await erasureResponse.json()).toMatchObject({ ok: true, erasure: { id: "record-1", status: "pending" } });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.map(([, values]) => values.slice(1, 5))).toEqual([
      ["acme", "acme", "organization", null],
      ["acme", "acme", "organization", null],
    ]);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("returns a legal-hold conflict and still releases the database connection", async () => {
    persistence.mockReturnValue({ mode: "postgres", databaseUrl: "postgres://invalid.test/mock" });
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "erasure-1",
          tenant_id: "acme",
          requested_by: "acme",
          scope: "organization",
          scope_id: null,
          status: "blocked_by_hold",
          dry_run: true,
          created_at: new Date("2026-10-30T00:00:00Z"),
        },
      ],
    });
    const close = vi.fn().mockResolvedValue(undefined);
    createPgQueryExecutor.mockReturnValue({ query, close });

    const response = await POST(request({ installationId: "inst-a", scope: "organization", dryRun: true }));
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "Blocked by legal hold",
      erasure: { id: "erasure-1", status: "blocked_by_hold" },
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects oversized JSON intake payloads before reading or using persistence", async () => {
    for (const post of [POST, postExport]) {
      for (const headers of [
        { "content-type": "application/json" },
        { "content-type": "application/json", "content-length": "65536" },
      ]) {
        const response = await post(
          new Request("https://boardreadyops.test/api/v1/lifecycle", {
            method: "POST",
            headers,
            body: JSON.stringify({ scope: "organization", unused: "x".repeat(16 * 1024) }),
          }),
        );
        expect(response.status).toBe(413);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(await response.json()).toMatchObject({ ok: false, error: "Request payload too large" });
      }
    }
    expect(persistence).not.toHaveBeenCalled();
    expect(createPgQueryExecutor).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON for both routes without touching persistence", async () => {
    for (const post of [POST, postExport]) {
      const response = await post(
        new Request("https://boardreadyops.test/api/v1/lifecycle", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        }),
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ ok: false, error: "Invalid JSON" });
    }
    expect(persistence).not.toHaveBeenCalled();
    expect(createPgQueryExecutor).not.toHaveBeenCalled();
  });
});

describe("export request scope boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewerAuthorization.mockResolvedValue({
      session: { userId: 42, login: "acme", installationIds: [10] },
    });
    persistence.mockReturnValue({ mode: "memory" });
  });

  it("rejects invalid scopes before selecting a database", async () => {
    for (const scope of ["repository", "user"]) {
      for (const scopeId of [undefined, "", " ", " padded ", "\tvalue"]) {
        const response = await postExport(request({ scope, scopeId }));
        expect(response.status).toBe(400);
        expect((await response.json()) as unknown).toMatchObject({
          ok: false,
          issues: [expect.objectContaining({ path: ["scopeId"] })],
        });
      }
    }
    for (const scopeId of ["", "repo-1"]) {
      expect((await postExport(request({ scope: "organization", scopeId }))).status).toBe(400);
    }
    expect((await postExport(request({ scope: "tenant", scopeId: "repo-1" }))).status).toBe(400);
    expect(persistence).not.toHaveBeenCalled();
    expect(createPgQueryExecutor).not.toHaveBeenCalled();
  });

  it("preserves valid scopes, the default organization scope and authentication", async () => {
    for (const payload of [
      {},
      { scope: "organization" },
      { scope: "repository", scopeId: "repo-1" },
      { scope: "user", scopeId: "alice" },
    ]) {
      expect((await postExport(request(payload))).status).toBe(503);
    }
    expect(persistence).toHaveBeenCalledTimes(4);
    viewerAuthorization.mockResolvedValueOnce({ session: undefined });
    expect((await postExport(request({ scope: "organization" }))).status).toBe(401);
    expect(createPgQueryExecutor).not.toHaveBeenCalled();
  });
});
