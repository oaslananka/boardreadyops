import { DataLifecycleStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { resolveCloudPersistenceConfiguration } from "../../../../../lib/cloud-runtime-config.js";
import { viewerAuthorization } from "../../../../../lib/viewer-authorization.js";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ exportId: string }> }): Promise<Response> {
  const viewer = await viewerAuthorization();
  if (!viewer.session)
    return Response.json(
      { ok: false, error: "authentication required" },
      { status: 401, headers: { "cache-control": "private, no-store" } },
    );
  const { exportId } = await context.params;
  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres")
    return Response.json(
      { ok: false, error: "Database not configured" },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new DataLifecycleStore(executor);
    const tenantId = viewer.session.login;
    const exp = await store.getExport(tenantId, exportId);
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
