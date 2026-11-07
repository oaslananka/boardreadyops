import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const viewerAuthorization = vi.hoisted(() => vi.fn());
const persistence = vi.hoisted(() => vi.fn());
const resolveTenant = vi.hoisted(() => vi.fn());
const createPgQueryExecutor = vi.hoisted(() => vi.fn());
const sealedArchiveRead = vi.hoisted(() => vi.fn());
const createArchiveStream = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({ viewerAuthorization }));
vi.mock("../../../apps/web/lib/cloud-runtime-config.js", () => ({ resolveCloudPersistenceConfiguration: persistence }));
vi.mock("../../../apps/web/lib/settings-tenant.js", () => ({ resolveSettingsTenantScope: resolveTenant }));
vi.mock("@boardreadyops/db/pg-executor", () => ({ createPgQueryExecutor }));
vi.mock("../../../apps/web/lib/data-export-local-archive-storage.js", () => ({
  readSealedLocalExportArchive: sealedArchiveRead,
}));
vi.mock("../../../apps/web/lib/data-export-web-stream.js", () => ({
  createAuthorizedSealedLocalExportWebStream: createArchiveStream,
}));

import { DELETE, GET } from "../../../apps/web/app/api/v1/data-exports/[exportId]/route.js";

const exportId = "f847a9a5-0dfa-48a9-aa78-5a4d9b725561";
const path = `https://boardreadyops.test/api/v1/data-exports/${exportId}?installationId=inst-a`;
const context = { params: Promise.resolve({ exportId }) };
const bytes = Buffer.from(
  '{"kind":"boardreadyops.repository-metadata-export","coverage":"selected-installation-repositories-only"}',
);
const sha256 = createHash("sha256").update(bytes).digest("hex");

function database(rows: Record<string, unknown>[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  const close = vi.fn().mockResolvedValue(undefined);
  createPgQueryExecutor.mockReturnValue({ query, close });
  return { query, close };
}

describe("authenticated bounded metadata preview download and revocation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    viewerAuthorization.mockResolvedValue({ session: { login: "operator", userId: 42 } });
    resolveTenant.mockResolvedValue({ selected: { id: "inst-a", accountLogin: "organization-a" } });
    persistence.mockReturnValue({ mode: "postgres", databaseUrl: "test-only" });
  });

  it("allows only short-lived manifest bytes with non-cacheable attachment headers", async () => {
    const { query, close } = database([{ prepared_manifest_bytes: bytes, prepared_manifest_sha256: sha256 }]);
    const response = await GET(new Request(`${path}&download=metadata-manifest`), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toContain(`boardreadyops-metadata-${exportId}.json`);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(query).toHaveBeenCalledTimes(2);
    expect(resolveTenant).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[1]).toEqual([exportId, "organization-a", "inst-a", "operator"]);
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("lower(data_exports.requested_by)=lower($4)");
    expect(sql).toContain("manifest_preview_expires_at > NOW()");
    expect(sql).toContain("manifest_preview_revoked_at IS NULL");
    expect(sql).toContain("installations.suspended_at IS NULL");
    expect(sql).toContain("repositories.installation_id=installations.id");
    expect(close).toHaveBeenCalledOnce();
  });

  it("denies missing session, foreign installation, unsupported format and unready manifest", async () => {
    viewerAuthorization.mockResolvedValueOnce({ session: undefined });
    expect((await GET(new Request(`${path}&download=metadata-manifest`), context)).status).toBe(401);
    expect(
      (
        await GET(
          new Request(`https://boardreadyops.test/api/v1/data-exports/${exportId}?download=metadata-manifest`),
          context,
        )
      ).status,
    ).toBe(400);
    resolveTenant.mockResolvedValueOnce({ selected: undefined });
    expect((await GET(new Request(`${path}&download=metadata-manifest`), context)).status).toBe(403);
    expect((await GET(new Request(`${path}&download=zip`), context)).status).toBe(400);
    database([]);
    expect((await GET(new Request(`${path}&download=metadata-manifest`), context)).status).toBe(404);
  });

  it("keeps customer ZIP download disabled until a private archive root is explicitly configured", async () => {
    vi.stubEnv("BOARDREADYOPS_PRIVATE_EXPORT_ARCHIVE_ROOT", "");
    const response = await GET(new Request(`${path}&download=archive`), context);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(createPgQueryExecutor).not.toHaveBeenCalled();
    expect(sealedArchiveRead).not.toHaveBeenCalled();
    expect(createArchiveStream).not.toHaveBeenCalled();

    vi.stubEnv("BOARDREADYOPS_PRIVATE_EXPORT_ARCHIVE_ROOT", "relative/private");
    expect((await GET(new Request(`${path}&download=archive`), context)).status).toBe(503);
    vi.stubEnv("BOARDREADYOPS_PRIVATE_EXPORT_ARCHIVE_ROOT", "/data/artifacts");
    vi.stubEnv("ARTIFACT_STORAGE_ROOT", "/data/artifacts");
    expect((await GET(new Request(`${path}&download=archive`), context)).status).toBe(503);

    expect((await GET(new Request(`${path}&download=archive&download=archive`), context)).status).toBe(400);
    expect((await GET(new Request(`${path}&download=archive&installationId=inst-b`), context)).status).toBe(400);
    expect(
      (
        await GET(
          new Request(`${path}&download=archive`, {
            headers: { origin: "https://untrusted.example" },
          }),
          context,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await GET(
          new Request(`${path}&download=archive`, {
            headers: { "sec-fetch-site": "cross-site" },
          }),
          context,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await GET(
          new Request(`${path}&download=archive`, {
            headers: { range: "bytes=0-5" },
          }),
          context,
        )
      ).status,
    ).toBe(416);
  });

  it("rejects foreign requesters or tampered sealed ZIP before issuing response headers", async () => {
    vi.stubEnv("BOARDREADYOPS_PRIVATE_EXPORT_ARCHIVE_ROOT", "/private-test-archive");
    const noAccess = database([]);
    expect((await GET(new Request(`${path}&download=archive`), context)).status).toBe(404);
    expect(noAccess.close).toHaveBeenCalledOnce();
    expect(sealedArchiveRead).not.toHaveBeenCalled();
    expect(createArchiveStream).not.toHaveBeenCalled();

    const claimed = {
      archive_sha256: "a".repeat(64),
      archive_byte_length: 1024,
      archive_files: 12,
      expires_at: new Date("2026-11-05T10:55:00Z"),
    };
    const mismatched = database([claimed]);
    sealedArchiveRead.mockResolvedValueOnce(null);
    expect((await GET(new Request(`${path}&download=archive`), context)).status).toBe(404);
    expect(mismatched.close).toHaveBeenCalledOnce();
    expect(sealedArchiveRead).toHaveBeenCalledWith({
      archiveRoot: "/private-test-archive",
      exportId,
      sha256: claimed.archive_sha256,
      byteLength: 1024,
    });
    expect(createArchiveStream).not.toHaveBeenCalled();
  });

  it("keeps the PostgreSQL executor alive through the authenticated ZIP Response stream", async () => {
    vi.stubEnv("BOARDREADYOPS_PRIVATE_EXPORT_ARCHIVE_ROOT", "/private-test-archive");
    const archive = Buffer.from("private ZIP payload");
    const persisted = {
      archive_sha256: "b".repeat(64),
      archive_byte_length: archive.byteLength,
      archive_files: 12,
      expires_at: new Date("2026-11-05T10:55:00Z"),
    };
    const { query, close } = database([persisted]);
    sealedArchiveRead.mockResolvedValueOnce(Buffer.from(archive));
    let complete!: (result: boolean) => void;
    const completed = new Promise<boolean>((resolve) => {
      complete = resolve;
    });
    createArchiveStream.mockReturnValue({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(archive));
          controller.close();
        },
      }),
      completed,
    });
    const response = await GET(new Request(`${path}&download=archive`), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-length")).toBe(String(archive.byteLength));
    expect(response.headers.get("content-disposition")).toContain(`boardreadyops-export-${exportId}.zip`);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[1]).toEqual([exportId, "organization-a", "inst-a", "operator"]);
    expect(createArchiveStream).toHaveBeenCalledWith(
      expect.objectContaining({
        archiveRoot: "/private-test-archive",
        db: expect.objectContaining({ query }),
        actorLogin: "operator",
        tenantId: "organization-a",
        installationId: "inst-a",
        exportId,
      }),
    );
    expect(close).not.toHaveBeenCalled();
    expect(Buffer.from(await response.arrayBuffer())).toEqual(archive);
    expect(close).not.toHaveBeenCalled();
    complete(true);
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it("closes its database executor when ZIP stream setup fails or transfer is cancelled", async () => {
    vi.stubEnv("BOARDREADYOPS_PRIVATE_EXPORT_ARCHIVE_ROOT", "/private-test-archive");
    const persisted = {
      archive_sha256: "c".repeat(64),
      archive_byte_length: 12,
      archive_files: 12,
      expires_at: new Date("2026-11-05T10:55:00Z"),
    };
    const failed = database([persisted]);
    sealedArchiveRead.mockResolvedValueOnce(Buffer.alloc(12, 65));
    createArchiveStream.mockImplementationOnce(() => {
      throw new Error("stream initialization failed");
    });
    await expect(GET(new Request(`${path}&download=archive`), context)).rejects.toThrow("stream initialization failed");
    expect(failed.close).toHaveBeenCalledOnce();

    const interrupted = database([persisted]);
    sealedArchiveRead.mockResolvedValueOnce(Buffer.alloc(12, 65));
    createArchiveStream.mockReturnValueOnce({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
      completed: Promise.resolve(false),
    });
    const response = await GET(new Request(`${path}&download=archive`), context);
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(interrupted.close).toHaveBeenCalledOnce());
    expect(sealedArchiveRead).toHaveBeenCalledTimes(2);
  });

  it("does not release metadata if installation membership disappears during the manifest read", async () => {
    const { query, close } = database([{ prepared_manifest_bytes: bytes, prepared_manifest_sha256: sha256 }]);
    resolveTenant
      .mockResolvedValueOnce({ selected: { id: "inst-a", accountLogin: "organization-a" } })
      .mockResolvedValueOnce({ selected: undefined });
    const response = await GET(new Request(`${path}&download=metadata-manifest`), context);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(query).toHaveBeenCalledOnce();
    expect(resolveTenant).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not release a preview when its tenant identity changes during database IO", async () => {
    const { query } = database([{ prepared_manifest_bytes: bytes, prepared_manifest_sha256: sha256 }]);
    resolveTenant
      .mockResolvedValueOnce({ selected: { id: "inst-a", accountLogin: "organization-a" } })
      .mockResolvedValueOnce({ selected: { id: "inst-a", accountLogin: "organization-b" } });
    const response = await GET(new Request(`${path}&download=metadata-manifest`), context);
    expect(response.status).toBe(404);
    expect(query).toHaveBeenCalledOnce();
  });

  it("does not release bytes if the preview was revoked or its contents changed during authorization", async () => {
    const valid = { prepared_manifest_bytes: bytes, prepared_manifest_sha256: sha256 };
    const { query } = database([valid]);
    query.mockResolvedValueOnce({ rows: [valid] }).mockResolvedValueOnce({ rows: [] });
    const revoked = await GET(new Request(`${path}&download=metadata-manifest`), context);
    expect(revoked.status).toBe(404);
    expect(query).toHaveBeenCalledTimes(2);

    const changedBytes = Buffer.from('{"kind":"different-preview"}');
    const changedSha = createHash("sha256").update(changedBytes).digest("hex");
    const changed = database([valid]);
    changed.query.mockResolvedValueOnce({ rows: [valid] }).mockResolvedValueOnce({
      rows: [{ prepared_manifest_bytes: changedBytes, prepared_manifest_sha256: changedSha }],
    });
    const swapped = await GET(new Request(`${path}&download=metadata-manifest`), context);
    expect(swapped.status).toBe(404);
    expect(changed.query).toHaveBeenCalledTimes(2);
  });

  it("rejects changed persisted content instead of serving an unverified manifest", async () => {
    database([{ prepared_manifest_bytes: bytes, prepared_manifest_sha256: "0".repeat(64) }]);
    await expect(GET(new Request(`${path}&download=metadata-manifest`), context)).rejects.toThrow(
      "Persisted export manifest failed integrity verification",
    );
  });

  it("revoke requires same-origin request and original requester's current installation", async () => {
    expect((await DELETE(new Request(path, { method: "DELETE" }), context)).status).toBe(403);
    const { query, close } = database([{ id: exportId }]);
    const request = new Request(path, { method: "DELETE", headers: { origin: "https://boardreadyops.test" } });
    const response = await DELETE(request, context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, revoked: true });
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("lower(requested_by)=lower($4)");
    expect(sql).toContain("manifest_preview_revoked_at IS NULL");
    expect(query.mock.calls[0]?.[1]).toEqual([exportId, "organization-a", "inst-a", "operator"]);
    expect(close).toHaveBeenCalledOnce();
  });
  it("revokes only an original-requester ZIP commitment with an explicit same-origin target", async () => {
    const { query, close } = database([{ export_id: exportId }]);
    const archivePath = `${path}&revoke=archive`;
    const remove = (url: string, origin = "https://boardreadyops.test") =>
      new Request(url, { method: "DELETE", headers: { origin } });

    expect((await DELETE(remove(archivePath, "https://other.test"), context)).status).toBe(403);
    expect((await DELETE(remove(`${path}&revoke=not-supported`), context)).status).toBe(400);
    expect((await DELETE(remove(`${archivePath}&revoke=archive`), context)).status).toBe(400);
    expect((await DELETE(remove(archivePath), context)).status).toBe(200);

    const [sql, params] = query.mock.calls[0] as [string, string[]];
    expect(sql).toContain("WITH revoked AS");
    expect(sql).toContain("commitment.revoked_at IS NULL");
    expect(sql).toContain("lower(exports.requested_by) = lower($4)");
    expect(sql).toContain("installations.suspended_at IS NULL");
    expect(sql).toContain("repositories.installation_id = installations.id");
    expect(sql).toContain("data_export.archive.revoked");
    expect(sql).toContain("audit_events");
    expect(params).toEqual([exportId, "organization-a", "inst-a", "operator"]);
    expect(close).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();

    database([]);
    const denied = await DELETE(remove(archivePath), context);
    expect(denied.status).toBe(404);
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
    expect(await denied.json()).toEqual({ ok: false, error: "not found" });
  });

  it("rejects untrusted preview identifiers and denies unsafe revocation preconditions", async () => {
    database([]);
    const invalidContext = { params: Promise.resolve({ exportId: "../not-an-export" }) };
    expect((await GET(new Request(`${path}&download=metadata-manifest`), invalidContext)).status).toBe(404);
    const remove = (url: string) =>
      new Request(url, { method: "DELETE", headers: { origin: "https://boardreadyops.test" } });
    viewerAuthorization.mockResolvedValueOnce({ session: undefined });
    expect((await DELETE(remove(path), context)).status).toBe(401);
    expect((await DELETE(remove(`https://boardreadyops.test/api/v1/data-exports/${exportId}`), context)).status).toBe(
      400,
    );
    persistence.mockReturnValueOnce({ mode: "memory" });
    expect((await DELETE(remove(path), context)).status).toBe(503);
    resolveTenant.mockResolvedValueOnce({ selected: undefined });
    expect((await DELETE(remove(path), context)).status).toBe(403);
    expect((await DELETE(remove(path), invalidContext)).status).toBe(404);
  });
});
