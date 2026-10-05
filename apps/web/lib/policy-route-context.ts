import { ReviewPolicyStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { optionalCloudPersistenceConfiguration } from "./cloud-runtime-config.js";
import type { UserSession } from "./user-session.js";
import { viewerAuthorization } from "./viewer-authorization.js";

export async function requirePolicyViewer(): Promise<UserSession | Response> {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return Response.json({ ok: false, error: "authentication required" }, { status: 401 });
  }
  return viewer.session;
}

export async function withPolicyStore(operation: (store: ReviewPolicyStore) => Promise<Response>): Promise<Response> {
  const config = optionalCloudPersistenceConfiguration();
  if (config?.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    return await operation(new ReviewPolicyStore(executor));
  } finally {
    await executor.close();
  }
}
