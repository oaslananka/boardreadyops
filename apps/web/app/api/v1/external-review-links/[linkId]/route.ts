import { ExternalReviewStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { authenticateApiRequest } from "../../../../../lib/api-auth.js";
import { resolveCloudPersistenceConfiguration } from "../../../../../lib/cloud-runtime-config.js";

export const runtime = "nodejs";

export async function DELETE(request: Request, props: { params: Promise<{ linkId: string }> }): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reviews:write");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }
  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });

  const { linkId } = await props.params;

  try {
    const store = new ExternalReviewStore(executor);
    const revoked = await store.revokeInvitation(auth.actorId, linkId);
    if (!revoked) {
      return Response.json({ ok: false, error: "External review link not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } finally {
    await executor.close();
  }
}
