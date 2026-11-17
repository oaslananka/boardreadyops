import { handoffLinksEnabled, planTierOf } from "@boardreadyops/cloud-core/entitlements";
import { createExternalReviewRequestSchema } from "@boardreadyops/contracts";
import { ExternalReviewStore, ReviewStore } from "@boardreadyops/db";
import { createPgQueryExecutor, type PgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { z } from "zod";
import { authenticateApiRequest, resolveRepositoryApiContext } from "../../../../lib/api-auth.js";
import { RequestBodyTooLargeError, readBoundedRequestBody } from "../../../../lib/bounded-request-body.js";
import { resolveCloudPersistenceConfiguration } from "../../../../lib/cloud-runtime-config.js";

export const runtime = "nodejs";

const maximumLinkBodyBytes = 64 * 1024;

/**
 * The plan tier gating this feature (`handoffLinksEnabled`) is unread until now: creating an
 * external review link previously required no entitlement at all, on every plan.
 */
export async function repositoryPlanTier(executor: PgQueryExecutor, repositoryId: string) {
  const result = await executor.query(
    `select installations.plan_tier
       from repositories
       join installations on installations.id = repositories.installation_id
      where repositories.id = $1`,
    [repositoryId],
  );
  const rows = (result as { rows?: readonly Record<string, unknown>[] }).rows ?? [];
  const value = rows[0]?.plan_tier;
  return planTierOf(typeof value === "string" ? value : undefined);
}

export async function repositoryTenantId(executor: PgQueryExecutor, repositoryId: string): Promise<string | undefined> {
  const result = await executor.query(
    `select repositories.installation_id
       from repositories
      where repositories.id = $1`,
    [repositoryId],
  );
  const rows = (result as { rows?: readonly Record<string, unknown>[] }).rows ?? [];
  const value = rows[0]?.installation_id;
  return typeof value === "string" ? value : undefined;
}

const createLinkSchema = createExternalReviewRequestSchema.extend({
  reviewId: z.string().min(1),
});

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reviews:read");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const reviewId = url.searchParams.get("reviewId");
  if (!reviewId) {
    return Response.json({ ok: false, error: "reviewId is required" }, { status: 400 });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }
  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });

  try {
    const reviewResult = await executor.query(
      `select reviews.repository_id, repositories.installation_id
         from reviews
         join repositories on repositories.id = reviews.repository_id
        where reviews.id = $1`,
      [reviewId],
    );
    const reviewRow = (reviewResult as { rows?: readonly Record<string, unknown>[] }).rows?.[0];
    if (!reviewRow || typeof reviewRow.repository_id !== "string" || typeof reviewRow.installation_id !== "string") {
      return Response.json({ ok: false, error: "Review not found" }, { status: 404 });
    }

    const repositoryId = reviewRow.repository_id;
    const tenantId = reviewRow.installation_id;

    const ctx = await resolveRepositoryApiContext(auth, request, repositoryId);
    if (ctx instanceof Response) return ctx;

    try {
      const store = new ExternalReviewStore(ctx.executor);
      const invitations = await store.listInvitationsForReview(tenantId, reviewId);
      return Response.json({ ok: true, invitations });
    } finally {
      await ctx.executor.close();
    }
  } finally {
    await executor.close();
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reviews:write");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  // Validate before repository authorization allocates an executor; malformed
  // and oversized bodies must not consume database connections.
  let body: unknown;
  try {
    const rawBody = (await readBoundedRequestBody(request, maximumLinkBodyBytes)).toString("utf8");
    body = JSON.parse(rawBody);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ ok: false, error: "External review link payload too large" }, { status: 413 });
    }
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createLinkSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid external review link payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const ctx = await resolveRepositoryApiContext(auth, request);
  if (ctx instanceof Response) return ctx;
  const { repositoryId, executor } = ctx;
  try {
    const reviewStore = new ReviewStore(executor);
    const review = await reviewStore.getReviewById(repositoryId, parsed.data.reviewId);
    if (!review) {
      return Response.json({ ok: false, error: "Review not found" }, { status: 404 });
    }

    const tier = await repositoryPlanTier(executor, repositoryId);
    if (!handoffLinksEnabled(tier)) {
      return Response.json(
        { ok: false, error: "External review links require the Team plan or higher." },
        { status: 403 },
      );
    }

    const tenantId = await repositoryTenantId(executor, repositoryId);
    if (!tenantId) {
      return Response.json({ ok: false, error: "Repository installation not found" }, { status: 404 });
    }

    const store = new ExternalReviewStore(executor);
    const { invitation, rawToken } = await store.createInvitation({
      tenantId,
      reviewId: parsed.data.reviewId,
      recipientEmail: parsed.data.recipientEmail,
      recipientName: parsed.data.recipientName,
      scope: parsed.data.scope,
      expiresInDays: parsed.data.expiresInDays,
      createdById: auth.actorId,
    });

    // rawToken is only ever available at creation time - the store only persists its hash.
    return Response.json({ ok: true, invitation, token: rawToken }, { status: 201 });
  } finally {
    await executor.close();
  }
}
