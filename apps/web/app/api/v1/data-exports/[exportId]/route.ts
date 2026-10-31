import { DataExportPreparationStore, DataLifecycleStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { resolveCloudPersistenceConfiguration } from "../../../../../lib/cloud-runtime-config.js";
import { resolveSettingsTenantScope } from "../../../../../lib/settings-tenant.js";
import { viewerAuthorization } from "../../../../../lib/viewer-authorization.js";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ exportId: string }> }): Promise<Response> {
  const viewer = await viewerAuthorization();
  if (!viewer.session)
    return Response.json(
      { ok: false, error: "authentication required" },
      { status: 401, headers: { "cache-control": "private, no-store" } },
    );
  const installationId = new URL(request.url).searchParams.get("installationId");
  const canonicalInstallationId = installationId?.trim();
  if (!canonicalInstallationId || canonicalInstallationId !== installationId) {
    return Response.json(
      { ok: false, error: "installationId is required" },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
  const { exportId } = await context.params;
  const download = new URL(request.url).searchParams.get("download");
  if (download && download !== "metadata-manifest")
    return Response.json(
      { ok: false, error: "invalid download format" },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres")
    return Response.json(
      { ok: false, error: "Database not configured" },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  const selected = (await resolveSettingsTenantScope(viewer.session, canonicalInstallationId)).selected;
  const tenantLogin = selected?.accountLogin.trim();
  if (!tenantLogin || tenantLogin.startsWith("Installation #")) {
    return Response.json(
      { ok: false, error: "installation access denied" },
      { status: 403, headers: { "cache-control": "private, no-store" } },
    );
  }
  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    if (download === "metadata-manifest") {
      // A metadata preview is NOT a full customer data export or an archive.
      if (!/^[0-9a-f-]{36}$/u.test(exportId))
        return Response.json(
          { ok: false, error: "not found" },
          { status: 404, headers: { "cache-control": "private, no-store" } },
        );
      const preview = await new DataExportPreparationStore(executor).readPublishedManifestPreview({
        exportId,
        tenantId: tenantLogin,
        installationId: canonicalInstallationId,
        actorLogin: viewer.session.login,
      });
      if (!preview)
        return Response.json(
          { ok: false, error: "not found" },
          { status: 404, headers: { "cache-control": "private, no-store" } },
        );
      return new Response(new Uint8Array(preview.bytes), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="boardreadyops-metadata-${exportId}.json"`,
          "content-length": String(preview.byteLength),
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox",
        },
      });
    }
    const store = new DataLifecycleStore(executor);
    const tenantId = tenantLogin;
    const exp = await store.getExport(tenantId, exportId, canonicalInstallationId);
    if (!exp)
      return Response.json(
        { ok: false, error: "not found" },
        { status: 404, headers: { "cache-control": "private, no-store" } },
      );
    return Response.json({ ok: true, export: exp }, { status: 200, headers: { "cache-control": "private, no-store" } });
  } finally {
    await executor.close();
  }
}

/** Revoke only the requester's metadata preview, without canceling the export or deleting evidence. */
export async function DELETE(request: Request, context: { params: Promise<{ exportId: string }> }): Promise<Response> {
  const noStore = { "cache-control": "private, no-store" };
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!origin || origin !== url.origin)
    return Response.json({ ok: false, error: "origin denied" }, { status: 403, headers: noStore });
  const viewer = await viewerAuthorization();
  if (!viewer.session)
    return Response.json({ ok: false, error: "authentication required" }, { status: 401, headers: noStore });
  const installationId = url.searchParams.get("installationId");
  if (!installationId?.trim() || installationId.trim() !== installationId)
    return Response.json({ ok: false, error: "installationId is required" }, { status: 400, headers: noStore });
  const { exportId } = await context.params;
  if (!/^[0-9a-f-]{36}$/u.test(exportId))
    return Response.json({ ok: false, error: "not found" }, { status: 404, headers: noStore });
  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres")
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503, headers: noStore });
  const selected = (await resolveSettingsTenantScope(viewer.session, installationId)).selected;
  const tenantId = selected?.accountLogin.trim();
  if (!tenantId || tenantId.startsWith("Installation #"))
    return Response.json({ ok: false, error: "installation access denied" }, { status: 403, headers: noStore });
  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const revoked = await new DataExportPreparationStore(executor).revokePublishedManifestPreview({
      exportId,
      tenantId,
      installationId,
      actorLogin: viewer.session.login,
    });
    return Response.json(revoked ? { ok: true, revoked: true } : { ok: false, error: "not found" }, {
      status: revoked ? 200 : 404,
      headers: noStore,
    });
  } finally {
    await executor.close();
  }
}
