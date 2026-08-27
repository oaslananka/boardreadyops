import { DataLifecycleStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { z } from "zod";
import { resolveCloudPersistenceConfiguration } from "../../../../lib/cloud-runtime-config.js";
import { viewerAuthorization } from "../../../../lib/viewer-authorization.js";

export const runtime = "nodejs";

const erasureSchema = z.object({
  scope: z.enum(["organization", "repository", "user"]),
  scopeId: z.string().optional(),
  dryRun: z.boolean().optional().default(false),
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
  const parsed = erasureSchema.safeParse(body);
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
    const tenantId = viewer.session.login;
    const erasure = await store.createErasure({
      tenantId,
      requestedBy: viewer.session.login,
      scope: parsed.data.scope,
      scopeId: parsed.data.scopeId ?? null,
      dryRun: parsed.data.dryRun,
    });
    if (erasure.status === "blocked_by_hold") {
      return Response.json(
        { ok: false, error: "Blocked by legal hold", erasure },
        { status: 409, headers: { "cache-control": "private, no-store" } },
      );
    }
    return Response.json({ ok: true, erasure }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } finally {
    await executor.close();
  }
}
