import { createExternalReviewRequestSchema } from "@boardreadyops/contracts";
import { ExternalReviewStore, ReviewStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { z } from "zod";
import { authenticateApiRequest, resolveRepositoryApiContext } from "../../../../lib/api-auth.js";
import { resolveCloudPersistenceConfiguration } from "../../../../lib/cloud-runtime-config.js";

export const runtime = "nodejs";

const createLinkSchema = createExternalReviewRequestSchema.extend({
  reviewId: z.string().min(1),
});

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reviews:read");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }
  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });

  const url = new URL(request.url);
  const reviewId = url.searchParams.get("reviewId");
  if (!reviewId) {
    return Response.json({ ok: false, error: "reviewId is required" }, { status: 400 });
  }

  try {
    const store = new ExternalReviewStore(executor);
    const invitations = await store.listInvitationsForReview(auth.actorId, reviewId);
    return Response.json({ ok: true, invitations });
  } finally {
    await executor.close();
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reviews:write");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const ctx = resolveRepositoryApiContext(auth, request);
  if (ctx instanceof Response) return ctx;
  const { repositoryId, executor } = ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createLinkSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid external review link payload", issues: parsed.error.issues },
      {
        status: 400,
      },
    );
  }

  try {
    const reviewStore = new ReviewStore(executor);
    const review = await reviewStore.getReviewById(repositoryId, parsed.data.reviewId);
    if (!review) {
      return Response.json({ ok: false, error: "Review not found" }, { status: 404 });
    }

    const store = new ExternalReviewStore(executor);
    const { invitation, rawToken } = await store.createInvitation({
      tenantId: auth.actorId,
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
