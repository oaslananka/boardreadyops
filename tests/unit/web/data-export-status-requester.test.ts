import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  viewerAuthorization: vi.fn(),
  resolveSettingsTenantScope: vi.fn(),
  persistence: vi.fn(),
  openDb: vi.fn(),
  getExport: vi.fn(),
  readArchiveForRequester: vi.fn(),
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
  DataExportArchiveCommitmentStore: class {
    readForRequester = mocks.readArchiveForRequester;
  },
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
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.viewerAuthorization.mockResolvedValue({ session: { login: "another-member", userId: 42 } });
    mocks.resolveSettingsTenantScope.mockResolvedValue({ selected: { id: "inst-a", accountLogin: "organization-a" } });
    mocks.persistence.mockReturnValue({ mode: "postgres", databaseUrl: "test-only" });
    mocks.openDb.mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) });
    mocks.getExport.mockResolvedValue(record);
    mocks.readArchiveForRequester.mockResolvedValue(null);
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

  it("advertises only a currently staged, requester-authorized ZIP when private delivery is configured", async () => {
    vi.stubEnv("BOARDREADYOPS_PRIVATE_EXPORT_ARCHIVE_ROOT", "/private/archive");
    vi.stubEnv("ARTIFACT_STORAGE_ROOT", "/storage/artifacts");
    mocks.viewerAuthorization.mockResolvedValue({ session: { login: "Original-Requester", userId: 52 } });
    mocks.readArchiveForRequester.mockResolvedValue({ sha256: "a".repeat(64), byteLength: 4096 });
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(200);
    expect((await response.json()).export.archivePrepared).toBe(true);
    expect(mocks.readArchiveForRequester).toHaveBeenCalledWith({
      exportId,
      tenantId: "organization-a",
      installationId: "inst-a",
      actorLogin: "Original-Requester",
    });
  });

  it("never advertises an archive when delivery is disabled or the original requester is denied", async () => {
    vi.stubEnv("BOARDREADYOPS_PRIVATE_EXPORT_ARCHIVE_ROOT", "");
    mocks.viewerAuthorization.mockResolvedValue({ session: { login: "Original-Requester", userId: 52 } });
    let response = await GET(new Request(url), context);
    expect((await response.json()).export.archivePrepared).toBe(false);
    expect(mocks.readArchiveForRequester).not.toHaveBeenCalled();

    vi.stubEnv("BOARDREADYOPS_PRIVATE_EXPORT_ARCHIVE_ROOT", "relative/archive");
    response = await GET(new Request(url), context);
    expect((await response.json()).export.archivePrepared).toBe(false);
    expect(mocks.readArchiveForRequester).not.toHaveBeenCalled();

    vi.stubEnv("BOARDREADYOPS_PRIVATE_EXPORT_ARCHIVE_ROOT", "/storage/artifacts");
    vi.stubEnv("ARTIFACT_STORAGE_ROOT", "/storage/artifacts");
    response = await GET(new Request(url), context);
    expect((await response.json()).export.archivePrepared).toBe(false);
    expect(mocks.readArchiveForRequester).not.toHaveBeenCalled();

    vi.stubEnv("BOARDREADYOPS_PRIVATE_EXPORT_ARCHIVE_ROOT", "/private/archive");
    mocks.readArchiveForRequester.mockResolvedValue(null);
    response = await GET(new Request(url), context);
    expect((await response.json()).export.archivePrepared).toBe(false);

    mocks.resolveSettingsTenantScope
      .mockResolvedValueOnce({ selected: { id: "inst-a", accountLogin: "organization-a" } })
      .mockResolvedValueOnce({ selected: undefined });
    response = await GET(new Request(url), context);
    expect(response.status).toBe(404);
    expect(mocks.readArchiveForRequester).toHaveBeenCalledTimes(1);

    mocks.viewerAuthorization.mockResolvedValue({ session: { login: "Another-Member", userId: 12 } });
    response = await GET(new Request(url), context);
    expect(response.status).toBe(404);
    expect(mocks.readArchiveForRequester).toHaveBeenCalledTimes(1);
  });

  it("denies private status when the original installation is revoked during the database read", async () => {
    mocks.viewerAuthorization.mockResolvedValue({ session: { login: "Original-Requester", userId: 52 } });
    mocks.resolveSettingsTenantScope
      .mockResolvedValueOnce({ selected: { id: "inst-a", accountLogin: "organization-a" } })
      .mockResolvedValueOnce({ selected: undefined });

    const response = await GET(new Request(url), context);
    const body = await response.text();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).not.toContain("private-repository-id");
    expect(body).not.toContain("original-requester");
    expect(mocks.resolveSettingsTenantScope).toHaveBeenCalledTimes(2);
  });

  it("does not publish a status that disappeared or was revoked after its initial database lookup", async () => {
    mocks.viewerAuthorization.mockResolvedValue({ session: { login: "Original-Requester", userId: 52 } });
    mocks.getExport.mockResolvedValueOnce(record).mockResolvedValueOnce(null);
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(404);
    expect(mocks.getExport).toHaveBeenCalledTimes(2);
  });

  it("uses the latest authorized status when it changes during a request", async () => {
    mocks.viewerAuthorization.mockResolvedValue({ session: { login: "Original-Requester", userId: 52 } });
    mocks.getExport.mockResolvedValueOnce(record).mockResolvedValueOnce({ ...record, status: "ready" });

    const response = await GET(new Request(url), context);
    expect(response.status).toBe(200);
    expect((await response.json()).export).toMatchObject({ status: "ready", requestedBy: "original-requester" });
    expect(mocks.getExport).toHaveBeenCalledTimes(2);
  });

  it("does not reveal the status if the stored requester changes during the request", async () => {
    mocks.viewerAuthorization.mockResolvedValue({ session: { login: "Original-Requester", userId: 52 } });
    mocks.getExport.mockResolvedValueOnce(record).mockResolvedValueOnce({ ...record, requestedBy: "other-user" });

    const response = await GET(new Request(url), context);
    expect(response.status).toBe(404);
    expect(mocks.getExport).toHaveBeenCalledTimes(2);
  });

  it("rejects ambiguous duplicate installation selectors instead of choosing one", async () => {
    mocks.viewerAuthorization.mockResolvedValue({ session: { login: "Original-Requester", userId: 52 } });
    const response = await GET(new Request(`${url}&installationId=inst-b`), context);
    expect(response.status).toBe(400);
    expect(mocks.resolveSettingsTenantScope).not.toHaveBeenCalled();
    expect(mocks.getExport).not.toHaveBeenCalled();
  });

  it("does not expose a status if the stored requester identity is invalid", async () => {
    mocks.getExport.mockResolvedValue({ ...record, requestedBy: null });
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(404);
  });
});
