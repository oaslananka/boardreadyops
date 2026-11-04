import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  viewerAuthorization: vi.fn(),
  resolveSettingsTenantScope: vi.fn(),
  persistence: vi.fn(),
  openDb: vi.fn(),
  getExport: vi.fn(),
}));
vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({ viewerAuthorization: mocks.viewerAuthorization }));
vi.mock("../../../apps/web/lib/settings-tenant.js", () => ({
  resolveSettingsTenantScope: mocks.resolveSettingsTenantScope,
}));
vi.mock("../../../apps/web/lib/cloud-runtime-config.js", () => ({
  resolveCloudPersistenceConfiguration: mocks.persistence,
}));
vi.mock("@boardreadyops/db/pg-executor", () => ({ createPgQueryExecutor: mocks.openDb }));
vi.mock("@boardreadyops/db", () => ({
  DataLifecycleStore: class {
    getExport = mocks.getExport;
  },
  DataExportPreparationStore: class {},
}));

import { GET } from "../../../apps/web/app/api/v1/data-exports/[exportId]/route.js";

const exportId = "f847a9a5-0dfa-48a9-aa78-5a4d9b725561";
const url = `https://boardreadyops.test/api/v1/data-exports/${exportId}?installationId=inst-a`;
const context = { params: Promise.resolve({ exportId }) };
const record = {
  id: exportId,
  tenantId: "organization-a",
  requestedBy: "original-requester",
  status: "running",
  scope: "repository",
  scopeId: "private-repository-id",
  expiresAt: null,
  createdAt: "2026-11-04T08:00:00.000Z",
};

describe("data export status requester authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.viewerAuthorization.mockResolvedValue({ session: { login: "another-member", userId: 42 } });
    mocks.resolveSettingsTenantScope.mockResolvedValue({ selected: { id: "inst-a", accountLogin: "organization-a" } });
    mocks.persistence.mockReturnValue({ mode: "postgres", databaseUrl: "test-only" });
    mocks.openDb.mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) });
    mocks.getExport.mockResolvedValue(record);
  });

  it("does not expose another requester's export status or private repository scope to an installation member", async () => {
    const response = await GET(new Request(url), context);
    const body = await response.text();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).not.toContain("original-requester");
    expect(body).not.toContain("private-repository-id");
    expect(body).not.toContain("running");
  });

  it("allows the original requester, matching the canonical GitHub login without case sensitivity", async () => {
    mocks.viewerAuthorization.mockResolvedValue({ session: { login: "Original-Requester", userId: 52 } });
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({ ok: true, export: { id: exportId, requestedBy: "original-requester" } });
  });

  it("does not expose a status if the stored requester identity is invalid", async () => {
    mocks.getExport.mockResolvedValue({ ...record, requestedBy: null });
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(404);
  });
});
