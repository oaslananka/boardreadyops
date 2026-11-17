import { ExternalReviewStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { authenticateApiRequest, resolveRepositoryApiContext } from "../../../../../lib/api-auth.js";
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
    const linkResult = await executor.query(
      `select external_review_invitations.id,
              external_review_invitations.tenant_id,
              reviews.repository_id
         from external_review_invitations
         join reviews on reviews.id = external_review_invitations.review_id
        where external_review_invitations.id = $1
          and external_review_invitations.revoked_at is null`,
      [linkId],
    );
    const linkRow = (linkResult as { rows?: readonly Record<string, unknown>[] }).rows?.[0];
    if (!linkRow || typeof linkRow.repository_id !== "string" || typeof linkRow.tenant_id !== "string") {
      return Response.json({ ok: false, error: "External review link not found" }, { status: 404 });
    }

    const ctx = await resolveRepositoryApiContext(auth, request, linkRow.repository_id);
    if (ctx instanceof Response) return ctx;

    try {
      const store = new ExternalReviewStore(ctx.executor);
      const revoked = await store.revokeInvitation(linkRow.tenant_id, linkId);
      if (!revoked) {
        return Response.json({ ok: false, error: "External review link not found" }, { status: 404 });
      }
      return Response.json({ ok: true });
    } finally {
      await ctx.executor.close();
    }
  } finally {
    await executor.close();
  }
}
