import { DataLifecycleStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { z } from "zod";
import { prepareLifecyclePost } from "../../../../lib/data-lifecycle-post-request.js";
import { lifecycleScopeRefinement } from "../../../../lib/data-lifecycle-scope-refinement.js";

export const runtime = "nodejs";

const erasureSchema = z
  .object({
    installationId: z
      .string()
      .min(1)
      .max(128)
      .refine((id) => id === id.trim(), "Canonical installation id required."),
    scope: z.enum(["organization", "repository", "user"]),
    scopeId: z.string().optional(),
    dryRun: z.boolean().optional().default(false),
  })
  .superRefine(lifecycleScopeRefinement("erasure"));

export async function POST(request: Request): Promise<Response> {
  const prepared = await prepareLifecyclePost(request, erasureSchema);
  if (!prepared.ok) return prepared.response;
  const executor = createPgQueryExecutor({ connectionString: prepared.databaseUrl });
  try {
    const store = new DataLifecycleStore(executor);
    const tenantId = prepared.tenantId;
    const erasure = await store.createErasure({
      tenantId,
      requestedBy: prepared.actorLogin,
      scope: prepared.data.scope,
      scopeId: prepared.data.scopeId ?? null,
      dryRun: prepared.data.dryRun,
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
