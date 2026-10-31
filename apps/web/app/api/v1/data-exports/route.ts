import { DataExportPreparationStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { z } from "zod";
import { prepareLifecyclePost } from "../../../../lib/data-lifecycle-post-request.js";
import { lifecycleScopeRefinement } from "../../../../lib/data-lifecycle-scope-refinement.js";

export const runtime = "nodejs";

const createExportSchema = z
  .object({
    installationId: z
      .string()
      .min(1)
      .max(128)
      .refine((id) => id === id.trim(), "Canonical installation id required."),
    scope: z.enum(["organization", "repository", "user"]).default("organization"),
    scopeId: z.string().optional(),
  })
  .superRefine(lifecycleScopeRefinement("export"));

export async function POST(request: Request): Promise<Response> {
  const prepared = await prepareLifecyclePost(request, createExportSchema);
  if (!prepared.ok) return prepared.response;
  if (prepared.data.scope === "user")
    return Response.json(
      {
        ok: false,
        error: "User-scoped exports require independently verified requester identity and are not available yet.",
      },
      { status: 422, headers: { "cache-control": "private, no-store" } },
    );
  const executor = createPgQueryExecutor({ connectionString: prepared.databaseUrl });
  try {
    const tenantId = prepared.tenantId;
    // Every new export is bound to a persisted live installation.
    const id = await new DataExportPreparationStore(executor).createBoundPendingExport({
      tenantId,
      installationId: prepared.data.installationId,
      requestedBy: prepared.actorLogin,
      scope: prepared.data.scope,
      scopeId: prepared.data.scopeId ?? null,
    });
    if (!id)
      return Response.json(
        { ok: false, error: "installation or repository access denied" },
        { status: 403, headers: { "cache-control": "private, no-store" } },
      );
    return Response.json(
      { ok: true, exportId: id, status: "pending" },
      { status: 201, headers: { "cache-control": "private, no-store" } },
    );
  } finally {
    await executor.close();
  }
}
