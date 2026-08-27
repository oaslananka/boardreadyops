import { DataLifecycleStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { z } from "zod";
import { resolveCloudPersistenceConfiguration } from "../../../../lib/cloud-runtime-config.js";
import { viewerAuthorization } from "../../../../lib/viewer-authorization.js";

export const runtime = "nodejs";

const createExportSchema = z.object({
  scope: z.enum(["organization", "repository", "user"]).default("organization"),
  scopeId: z.string().optional(),
});

export async function POST(request: Request): Promise<Response> {
  const viewer = await viewerAuthorization();
  if (!viewer.session)
    return Response.json(
      { ok: false, error: "authentication required" },
      { status: 401, headers: { "cache-control": "private, no-store" } },
    );
  let body: unknown = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as unknown;
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
  const parsed = createExportSchema.safeParse(body);
  if (!parsed.success)
    return Response.json(
      { ok: false, error: "Invalid payload", issues: parsed.error.issues },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres")
    return Response.json(
      { ok: false, error: "Database not configured" },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new DataLifecycleStore(executor);
    const tenantId = viewer.session.login; // simplified tenant mapping
    const exp = await store.createExport({
      tenantId,
      requestedBy: viewer.session.login,
      scope: parsed.data.scope,
      scopeId: parsed.data.scopeId ?? null,
    });
    // In production, enqueue async job to generate signed pack
    return Response.json(
      { ok: true, exportId: exp.id, status: exp.status },
      { status: 201, headers: { "cache-control": "private, no-store" } },
    );
  } finally {
    await executor.close();
  }
}
