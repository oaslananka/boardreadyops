import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const viewerAuthorization = vi.hoisted(() => vi.fn());
const persistence = vi.hoisted(() => vi.fn());
const resolveTenant = vi.hoisted(() => vi.fn());
const createPgQueryExecutor = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({ viewerAuthorization }));
vi.mock("../../../apps/web/lib/cloud-runtime-config.js", () => ({ resolveCloudPersistenceConfiguration: persistence }));
vi.mock("../../../apps/web/lib/settings-tenant.js", () => ({ resolveSettingsTenantScope: resolveTenant }));
vi.mock("@boardreadyops/db/pg-executor", () => ({ createPgQueryExecutor }));

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
    expect(query).toHaveBeenCalledOnce();
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
