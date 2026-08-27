import type { ReviewDecision, ReviewStatus } from "@boardreadyops/contracts";
import { ReviewStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { z } from "zod";
import { authenticateApiRequest } from "../../../../lib/api-auth.js";
import { resolveCloudPersistenceConfiguration } from "../../../../lib/cloud-runtime-config.js";

export const runtime = "nodejs";

const createReviewRequestSchema = z.object({
  repositoryId: z.string().min(1),
  pullRequestNumber: z.number().int().positive().optional(),
  title: z.string().min(1).max(256),
  headRunId: z.string().min(1),
  headCommitSha: z.string().min(7).max(64),
  baseRunId: z.string().min(1).optional(),
  baseCommitSha: z.string().min(7).max(64).optional(),
  evidenceDigest: z.string().regex(/^[0-9a-f]{64}$/u),
});

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reviews:read");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const repositoryId = auth.repositoryId ?? url.searchParams.get("repositoryId");
  if (!repositoryId) {
    return Response.json({ ok: false, error: "repositoryId is required" }, { status: 400 });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new ReviewStore(executor);
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 20;
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const status = (url.searchParams.get("status") as ReviewStatus | null) ?? undefined;
    const decision = (url.searchParams.get("decision") as ReviewDecision | null) ?? undefined;

    const result = await store.listReviews(repositoryId, {
      limit,
      ...(cursor ? { cursor } : {}),
      ...(status ? { status } : {}),
      ...(decision ? { decision } : {}),
    });

    return Response.json({
      ok: true,
      reviews: result.reviews,
      nextCursor: result.nextCursor ?? null,
    });
  } finally {
    await executor.close();
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reviews:write");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createReviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid review request payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const payload = parsed.data;
  // If bearer token is tied to a specific repo, ensure match
  if (auth.repositoryId && auth.repositoryId !== payload.repositoryId) {
    return Response.json({ ok: false, error: "Forbidden repository scope" }, { status: 403 });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new ReviewStore(executor);
    const result = await store.upsertReviewForRun({
      repositoryId: payload.repositoryId,
      ...(payload.pullRequestNumber !== undefined ? { pullRequestNumber: payload.pullRequestNumber } : {}),
      title: payload.title,
      headRunId: payload.headRunId,
      headCommitSha: payload.headCommitSha,
      ...(payload.baseRunId !== undefined ? { baseRunId: payload.baseRunId } : {}),
      ...(payload.baseCommitSha !== undefined ? { baseCommitSha: payload.baseCommitSha } : {}),
      evidenceDigest: payload.evidenceDigest,
      createdBy: auth.actorId,
    });

    return Response.json(
      {
        ok: true,
        review: result.review,
        revision: result.revision,
      },
      { status: 201 },
    );
  } finally {
    await executor.close();
  }
}
