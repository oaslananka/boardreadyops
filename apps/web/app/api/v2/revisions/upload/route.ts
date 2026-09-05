import { WorkspaceStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { z } from "zod";
import { authenticateApiRequest } from "../../../../../lib/api-auth.js";
import { resolveCloudPersistenceConfiguration } from "../../../../../lib/cloud-runtime-config.js";

export const runtime = "nodejs";

const createRevisionSchema = z.object({
  projectId: z.string().min(1),
  revisionLabel: z.string().min(1).max(64),
  bundleSha256: z.string().regex(/^[0-9a-f]{64}$/, "Must be 64-character lowercase hex digest"),
  sourceKind: z.enum(["direct_upload", "github_commit", "native_export"]).default("direct_upload"),
  commitSha: z.string().max(40).optional(),
  normalizedSummary: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "runs:write");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createRevisionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid revision payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new WorkspaceStore(executor);
    const revision = await store.createRevisionFromUpload({
      projectId: parsed.data.projectId,
      revisionLabel: parsed.data.revisionLabel,
      bundleSha256: parsed.data.bundleSha256,
      sourceKind: parsed.data.sourceKind,
      commitSha: parsed.data.commitSha,
      normalizedSummary: parsed.data.normalizedSummary,
    });
    return Response.json({ ok: true, revision }, { status: 201 });
  } finally {
    await executor.close();
  }
}
