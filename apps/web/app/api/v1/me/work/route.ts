import { ReviewStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { authenticateApiRequest } from "../../../../../lib/api-auth.js";
import { resolveCloudPersistenceConfiguration } from "../../../../../lib/cloud-runtime-config.js";
import { loadAssignedFindings } from "../../../../../lib/work-queue.js";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reviews:read");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const repositoryId = auth.repositoryId ?? url.searchParams.get("repositoryId");

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const reviewStore = new ReviewStore(executor);
    const assignedFindings = await loadAssignedFindings(executor, auth.actorId);

    let awaitingReviews: Awaited<ReturnType<typeof reviewStore.listReviews>>["reviews"] = [];
    let changesRequested: Awaited<ReturnType<typeof reviewStore.listReviews>>["reviews"] = [];
    if (repositoryId) {
      const [pending, requested] = await Promise.all([
        reviewStore.listReviews(repositoryId, { decision: "pending", limit: 50 }),
        reviewStore.listReviews(repositoryId, { decision: "changes_requested", limit: 50 }),
      ]);
      awaitingReviews = pending.reviews;
      changesRequested = requested.reviews;
    }

    return Response.json({
      ok: true,
      assignedFindings,
      awaitingReviews,
      changesRequested,
      scopedToRepository: repositoryId ?? null,
    });
  } finally {
    await executor.close();
  }
}
