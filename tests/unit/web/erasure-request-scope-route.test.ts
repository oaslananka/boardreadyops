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

import { GET as getExport } from "../../../apps/web/app/api/v1/data-exports/[exportId]/route.js";
import { POST as postExport } from "../../../apps/web/app/api/v1/data-exports/route.js";
import { POST } from "../../../apps/web/app/api/v1/erasure-requests/route.js";

function request(payload: unknown): Request {
  return new Request("https://boardreadyops.test/api/v1/erasure-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ installationId: "inst-a", ...(payload as Record<string, unknown>) }),
  });
}

describe("erasure request scope boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewerAuthorization.mockResolvedValue({
      session: { userId: 42, login: "acme", installationIds: [10] },
    });
    persistence.mockReturnValue({ mode: "memory" });
    resolveTenant.mockResolvedValue({
      selected: { id: "inst-a", accountLogin: "organization-a" },
      installations: [{ id: "inst-a", accountLogin: "organization-a" }],
    });
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
      selected: { id: "inst-a", accountLogin: "organization-a" },
      installations: [{ id: "inst-a", accountLogin: "organization-a" }],
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
    expect(query.mock.calls[0]?.[0]).toContain("repositories.installation_id = owned_installation.id");
    expect(query.mock.calls[0]?.[0]).toContain("suspended_at IS NULL");
    expect(query.mock.calls[0]?.[1]?.slice(1)).toEqual(["inst-a", "organization-a", "acme", "organization", null]);
    expect(query.mock.calls[1]?.[1]?.slice(1)).toEqual(["organization-a", "acme", "organization", null, false]);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("preserves user-scoped request intake without claiming that a preparable package exists", async () => {
    persistence.mockReturnValue({ mode: "postgres", databaseUrl: "postgres://invalid.test/mock" });
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "legacy-user",
          tenant_id: "organization-a",
          requested_by: "acme",
          status: "pending",
          scope: "user",
          scope_id: "acme",
          created_at: new Date("2026-10-30T00:00:00Z"),
        },
      ],
    });
    const close = vi.fn().mockResolvedValue(undefined);
    createPgQueryExecutor.mockReturnValue({ query, close });
    const response = await postExport(request({ scope: "user", scopeId: "acme" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ok: true, exportId: "legacy-user", status: "pending" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO data_exports"), [
      expect.any(String),
      "organization-a",
      "acme",
      "user",
      "acme",
    ]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("fails closed when persisted installation or repository authorization disappears after session resolution", async () => {
    persistence.mockReturnValue({ mode: "postgres", databaseUrl: "postgres://invalid.test/mock" });
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const close = vi.fn().mockResolvedValue(undefined);
    createPgQueryExecutor.mockReturnValue({ query, close });
    const result = await postExport(request({ scope: "repository", scopeId: "foreign-repo" }));
    expect(result.status).toBe(403);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await result.json()).toMatchObject({ ok: false, error: "installation or repository access denied" });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain("repositories.installation_id = owned_installation.id");
    expect(query.mock.calls[0]?.[1]?.slice(1)).toEqual([
      "inst-a",
      "organization-a",
      "acme",
      "repository",
      "foreign-repo",
    ]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns a legal-hold conflict and still releases the database connection", async () => {
    persistence.mockReturnValue({ mode: "postgres", databaseUrl: "postgres://invalid.test/mock" });
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "erasure-1",
          tenant_id: "organization-a",
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
    resolveTenant.mockResolvedValue({
      selected: { id: "inst-a", accountLogin: "organization-a" },
      installations: [{ id: "inst-a", accountLogin: "organization-a" }],
    });
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

describe("tenant-authorized lifecycle routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewerAuthorization.mockResolvedValue({
      session: { userId: 42, login: "human-operator", installationIds: [10] },
    });
    resolveTenant.mockResolvedValue({
      selected: { id: "inst-a", accountLogin: "organization-a" },
      installations: [{ id: "inst-a", accountLogin: "organization-a" }],
    });
    persistence.mockReturnValue({ mode: "postgres", databaseUrl: "postgres://disposable.invalid/test" });
  });

  it("requires an installation identifier on both write APIs before database access", async () => {
    for (const post of [POST, postExport]) {
      const response = await post(
        new Request("https://boardreadyops.test/api/v1/lifecycle", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scope: "organization" }),
        }),
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(resolveTenant).not.toHaveBeenCalled();
    expect(createPgQueryExecutor).not.toHaveBeenCalled();
  });

  it("refuses other installations for both writes without executing SQL", async () => {
    resolveTenant.mockResolvedValue({ selected: undefined, installations: [] });
    for (const post of [POST, postExport]) {
      const response = await post(request({ scope: "organization", installationId: "foreign-installation" }));
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(createPgQueryExecutor).not.toHaveBeenCalled();
  });

  it("uses authorized installation tenant for persisted export and erasure, never the human login", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "request-a",
          tenant_id: "organization-a",
          requested_by: "human-operator",
          scope: "organization",
          scope_id: null,
          status: "pending",
          dry_run: false,
          download_url: null,
          created_at: new Date("2026-10-30T00:00:00.000Z"),
        },
      ],
    });
    const close = vi.fn().mockResolvedValue(undefined);
    createPgQueryExecutor.mockReturnValue({ query, close });
    expect((await postExport(request({ scope: "organization" }))).status).toBe(201);
    expect((await POST(request({ scope: "organization" }))).status).toBe(201);
    expect(query).toHaveBeenCalledTimes(2);
    for (const [, values] of query.mock.calls) {
      expect(values).toEqual(expect.arrayContaining(["organization-a", "human-operator"]));
    }
    expect(close).toHaveBeenCalledTimes(2);
    expect(resolveTenant).toHaveBeenCalledWith(expect.objectContaining({ login: "human-operator" }), "inst-a");
  });

  it("GET export metadata rejects missing or foreign installation and reads the authorized tenant", async () => {
    const context = { params: Promise.resolve({ exportId: "ex-1" }) };
    const noInstallation = await getExport(new Request("https://boardreadyops.test/api/v1/data-exports/ex-1"), context);
    expect(noInstallation.status).toBe(400);
    const noncanonical = await getExport(
      new Request("https://boardreadyops.test/api/v1/data-exports/ex-1?installationId=%20inst-a%20"),
      context,
    );
    expect(noncanonical.status).toBe(400);

    resolveTenant.mockResolvedValueOnce({ selected: undefined, installations: [] });
    const denied = await getExport(
      new Request("https://boardreadyops.test/api/v1/data-exports/ex-1?installationId=other"),
      context,
    );
    expect(denied.status).toBe(403);
    expect(createPgQueryExecutor).not.toHaveBeenCalled();

    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "ex-1",
          tenant_id: "organization-a",
          requested_by: "human-operator",
          status: "pending",
          scope: "organization",
          scope_id: null,
          created_at: new Date("2026-10-30T00:00:00.000Z"),
        },
      ],
    });
    createPgQueryExecutor.mockReturnValue({ query, close: vi.fn().mockResolvedValue(undefined) });
    const response = await getExport(
      new Request("https://boardreadyops.test/api/v1/data-exports/ex-1?installationId=inst-a"),
      context,
    );
    expect(response.status).toBe(200);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SELECT * FROM data_exports"), [
      "ex-1",
      "organization-a",
    ]);
  });
});
