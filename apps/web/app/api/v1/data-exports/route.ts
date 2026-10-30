import { DataLifecycleStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { z } from "zod";
import { prepareLifecyclePost } from "../../../../lib/data-lifecycle-post-request.js";
import { lifecycleScopeRefinement } from "../../../../lib/data-lifecycle-scope-refinement.js";

export const runtime = "nodejs";

const createExportSchema = z
  .object({
    scope: z.enum(["organization", "repository", "user"]).default("organization"),
    scopeId: z.string().optional(),
  })
  .superRefine(lifecycleScopeRefinement("export"));

export async function POST(request: Request): Promise<Response> {
  const prepared = await prepareLifecyclePost(request, createExportSchema);
  if (!prepared.ok) return prepared.response;
  const executor = createPgQueryExecutor({ connectionString: prepared.databaseUrl });
  try {
    const store = new DataLifecycleStore(executor);
    const tenantId = prepared.actorLogin;
    const exp = await store.createExport({
      tenantId,
      requestedBy: prepared.actorLogin,
      scope: prepared.data.scope,
      scopeId: prepared.data.scopeId ?? null,
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
