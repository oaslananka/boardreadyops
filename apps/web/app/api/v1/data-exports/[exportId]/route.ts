import path from "node:path";
import { DataExportArchiveCommitmentStore, DataExportPreparationStore, DataLifecycleStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { resolveCloudPersistenceConfiguration } from "../../../../../lib/cloud-runtime-config.js";
import { readSealedLocalExportArchive } from "../../../../../lib/data-export-local-archive-storage.js";
import { createAuthorizedSealedLocalExportWebStream } from "../../../../../lib/data-export-web-stream.js";
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
  const url = new URL(request.url);
  const installationId = url.searchParams.get("installationId");
  const canonicalInstallationId = installationId?.trim();
  if (!canonicalInstallationId || canonicalInstallationId !== installationId) {
    return Response.json(
      { ok: false, error: "installationId is required" },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
  const { exportId } = await context.params;
  const download = url.searchParams.get("download");
  if (
    (download && download !== "metadata-manifest" && download !== "archive") ||
    (download === "archive" && url.searchParams.getAll("download").length !== 1)
  )
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
  if (download === "archive") {
    const noStore = { "cache-control": "private, no-store" };
    if (url.searchParams.getAll("installationId").length !== 1)
      return Response.json({ ok: false, error: "installationId is required" }, { status: 400, headers: noStore });
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(exportId))
      return Response.json({ ok: false, error: "not found" }, { status: 404, headers: noStore });

    // An authenticated GET must never turn into a cross-site export trigger.
    const origin = request.headers.get("origin");
    if ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site")
      return Response.json({ ok: false, error: "origin denied" }, { status: 403, headers: noStore });
    if (request.headers.has("range"))
      return Response.json({ ok: false, error: "range not supported" }, { status: 416, headers: noStore });

    // Nothing is exposed until a separate private 0700 same-UID directory has
    // been provisioned on the shared durable volume. Never use public uploads.
    const archiveRoot = process.env.BOARDREADYOPS_PRIVATE_EXPORT_ARCHIVE_ROOT?.trim();
    const artifactRoot = process.env.ARTIFACT_STORAGE_ROOT?.trim();
    if (
      !archiveRoot ||
      !path.isAbsolute(archiveRoot) ||
      (artifactRoot && path.resolve(archiveRoot) === path.resolve(artifactRoot))
    )
      return Response.json({ ok: false, error: "ZIP delivery unavailable" }, { status: 503, headers: noStore });

    const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
    let responseOwnsExecutor = false;
    try {
      const requester = {
        exportId,
        tenantId: tenantLogin,
        installationId: canonicalInstallationId,
        actorLogin: viewer.session.login,
      };
      // Fail closed before committing HTTP headers: current requester and
      // installation/repo scope are checked again inside the streaming txn.
      const staged = await new DataExportArchiveCommitmentStore(executor).readForRequester(requester);
      if (!staged) return Response.json({ ok: false, error: "not found" }, { status: 404, headers: noStore });
      const bytes = await readSealedLocalExportArchive({
        archiveRoot,
        exportId,
        sha256: staged.sha256,
        byteLength: staged.byteLength,
      });
      if (!bytes) return Response.json({ ok: false, error: "not found" }, { status: 404, headers: noStore });
      // This preflight buffer is NOT passed to the response. The transactional
      // stream independently validates the sealed bytes and current authority.
      bytes.fill(0);

      const { body, completed } = createAuthorizedSealedLocalExportWebStream({
        db: executor,
        archiveRoot,
        ...requester,
        signal: request.signal,
      });
      // Do not close the DB connection when GET returns the Response object.
      // It owns the revocation fence until Web Streams final pull/cancel/timeout.
      responseOwnsExecutor = true;
      void completed
        .then(
          () => executor.close(),
          () => executor.close(),
        )
        .catch(() => {});
      return new Response(body, {
        status: 200,
        headers: {
          ...noStore,
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="boardreadyops-export-${exportId}.zip"`,
          "content-length": String(staged.byteLength),
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox",
        },
      });
    } finally {
      if (!responseOwnsExecutor) await executor.close();
    }
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
      const previewStore = new DataExportPreparationStore(executor);
      const preview = await previewStore.readPublishedManifestPreview({
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
      // Database IO can overlap an uninstall or account/installation change.
      // Refresh the viewer's installation boundary and the original requester's
      // unexpired preview before releasing any previously read private bytes.
      const currentInstallation = (await resolveSettingsTenantScope(viewer.session, canonicalInstallationId)).selected;
      if (
        currentInstallation?.id !== canonicalInstallationId ||
        currentInstallation.accountLogin.trim().toLowerCase() !== tenantLogin.toLowerCase()
      )
        return Response.json(
          { ok: false, error: "not found" },
          { status: 404, headers: { "cache-control": "private, no-store" } },
        );
      const currentPreview = await previewStore.readPublishedManifestPreview({
        exportId,
        tenantId: tenantLogin,
        installationId: canonicalInstallationId,
        actorLogin: viewer.session.login,
      });
      if (currentPreview?.sha256 !== preview.sha256 || currentPreview.byteLength !== preview.byteLength)
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
    // Status metadata includes the requester's identity and private scope. Installation
    // membership alone does not grant access to another user's export request.
    // Match GitHub logins case-insensitively, as with the requester-bound preview API.
    if (
      !exp ||
      typeof exp.requestedBy !== "string" ||
      typeof viewer.session.login !== "string" ||
      exp.requestedBy.toLowerCase() !== viewer.session.login.toLowerCase()
    )
      return Response.json(
        { ok: false, error: "not found" },
        { status: 404, headers: { "cache-control": "private, no-store" } },
      );
    // Status metadata is not a delivery capability; never serialize a stored raw URL.
    return Response.json(
      {
        ok: true,
        export: {
          id: exp.id,
          tenantId: exp.tenantId,
          requestedBy: exp.requestedBy,
          status: exp.status,
          scope: exp.scope,
          scopeId: exp.scopeId,
          expiresAt: exp.expiresAt,
          createdAt: exp.createdAt,
        },
      },
      { status: 200, headers: { "cache-control": "private, no-store" } },
    );
  } finally {
    await executor.close();
  }
}

/**
 * Revoke the original requester's preview (default), or an independently
 * prepared ZIP commitment with ?revoke=archive. This never deletes evidence,
 * marks an export complete, or exposes a download capability.
 */
export async function DELETE(request: Request, context: { params: Promise<{ exportId: string }> }): Promise<Response> {
  const noStore = { "cache-control": "private, no-store" };
  const url = new URL(request.url);
  const revoke = url.searchParams.get("revoke");
  if (revoke !== null && (revoke !== "archive" || url.searchParams.getAll("revoke").length !== 1))
    return Response.json({ ok: false, error: "invalid revoke target" }, { status: 400, headers: noStore });
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
    const input = { exportId, tenantId, installationId, actorLogin: viewer.session.login };
    const revoked =
      revoke === "archive"
        ? await new DataExportArchiveCommitmentStore(executor).revokeForRequester(input)
        : await new DataExportPreparationStore(executor).revokePublishedManifestPreview(input);
    return Response.json(revoked ? { ok: true, revoked: true } : { ok: false, error: "not found" }, {
      status: revoked ? 200 : 404,
      headers: noStore,
    });
  } finally {
    await executor.close();
  }
}
