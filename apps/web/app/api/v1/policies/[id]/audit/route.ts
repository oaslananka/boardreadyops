import { ReviewPolicyStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { optionalCloudPersistenceConfiguration } from "../../../../../../lib/cloud-runtime-config.js";
import { viewerAuthorization } from "../../../../../../lib/viewer-authorization.js";

export const runtime = "nodejs";

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return Response.json({ ok: false, error: "authentication required" }, { status: 401 });
  }

  const { id } = await props.params;
  const config = optionalCloudPersistenceConfiguration();
  if (config?.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new ReviewPolicyStore(executor);
    const policy = await store.getPolicyById(id);
    if (policy && policy.tenantId !== viewer.session.login) {
      return Response.json({ ok: false, error: "Policy not found" }, { status: 404 });
    }

    const events = await store.listAuditEvents(viewer.session.login, id);
    if (!policy && events.length === 0) {
      return Response.json({ ok: false, error: "Policy not found" }, { status: 404 });
    }
    return Response.json({ ok: true, events });
  } finally {
    await executor.close();
  }
}
