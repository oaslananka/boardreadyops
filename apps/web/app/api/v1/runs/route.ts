import { randomUUID } from "node:crypto";
import { findingSchema, releaseRunArtifactSchema, triggerKindSchema } from "@boardreadyops/contracts";
import { ReviewStore } from "@boardreadyops/db";
import { z } from "zod";
import { authenticateApiRequest, resolveRepositoryApiContext } from "../../../../lib/api-auth.js";
import { decodeRunListingCursor, loadViewerRuns, normalizedRunListingLimit } from "../../../../lib/run-listing.js";
import { viewerAuthorization } from "../../../../lib/viewer-authorization.js";

export const runtime = "nodejs";

const ingestRunRequestSchema = z.object({
  repositoryId: z.string().min(1),
  commitSha: z.string().min(7).max(64),
  ref: z.string().min(1),
  pullRequestNumber: z.number().int().positive().optional(),
  triggerKind: triggerKindSchema.default("manual"),
  decision: z.enum(["pass", "fail", "error"]).optional(),
  title: z.string().max(256).optional(),
  findings: z.array(findingSchema).default([]),
  artifacts: z.array(releaseRunArtifactSchema).default([]),
  evidenceDigest: z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .optional(),
  baseRunId: z.string().optional(),
  baseCommitSha: z.string().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return Response.json({ ok: false, error: "authentication required" }, { status: 401 });
  }

  const searchParams = new URL(request.url).searchParams;
  const cursor = decodeRunListingCursor(searchParams.get("cursor"));
  if (searchParams.get("cursor") && !cursor) {
    return Response.json({ ok: false, error: "invalid cursor" }, { status: 400 });
  }
  const requestedLimit = searchParams.get("limit");
  const limit = normalizedRunListingLimit(requestedLimit ? Number(requestedLimit) : undefined);

  const page = await loadViewerRuns(viewer.session, { ...(cursor ? { cursor } : {}), limit });
  if (page.state === "not-configured") {
    return Response.json({ ok: false, error: "run store is not configured" }, { status: 503 });
  }

  return Response.json(
    { ok: true, runs: page.runs, next: page.next ?? null },
    { headers: { "cache-control": "private, no-store" } },
  );
}

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

  const parsed = ingestRunRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid run payload", issues: parsed.error.issues }, { status: 400 });
  }

  const payload = parsed.data;
  const ctx = await resolveRepositoryApiContext(auth, request, payload.repositoryId);
  if (ctx instanceof Response) return ctx;
  const { repositoryId, executor } = ctx;

  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? undefined;
  try {
    // 1. Check idempotency
    if (idempotencyKey) {
      const existing = await executor.query(
        `select * from release_runs where repository_id = $1 and idempotency_key = $2 limit 1`,
        [repositoryId, idempotencyKey],
      );
      const rows = ((existing as { rows?: { id: string; status: string }[] }).rows ?? []) as {
        id: string;
        status: string;
      }[];
      if (rows.length > 0 && rows[0]) {
        return Response.json(
          {
            ok: true,
            runId: rows[0].id,
            status: rows[0].status,
            deduplicated: true,
          },
          { status: 200 },
        );
      }
    }

    const runId = randomUUID();
    const now = new Date().toISOString();
    const decision = payload.decision ?? (payload.findings.some((f) => f.severity === "error") ? "fail" : "pass");

    // 2. Insert release_run
    await executor.query(
      `insert into release_runs (
        id, repository_id, idempotency_key, commit_sha, ref, pull_request_number, trigger_kind, status, decision, started_at, completed_at
      ) values ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, $9, $9)`,
      [
        runId,
        repositoryId,
        idempotencyKey ?? null,
        payload.commitSha,
        payload.ref,
        payload.pullRequestNumber ?? null,
        payload.triggerKind,
        decision,
        now,
      ],
    );

    // 3. Insert findings
    for (const f of payload.findings) {
      const findingId = randomUUID();
      await executor.query(
        `insert into findings (
          id, run_id, rule_id, severity, message, path, fingerprint
        ) values ($1, $2, $3, $4, $5, $6, $7)`,
        [findingId, runId, f.ruleId, f.severity, f.message, f.path ?? null, f.fingerprint ?? null],
      );
    }

    // 4. Insert artifacts
    for (const a of payload.artifacts) {
      const artifactId = randomUUID();
      await executor.query(
        `insert into artifacts (
          id, run_id, kind, name, storage_path, sha256, bytes, role
        ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [artifactId, runId, a.kind, a.name, a.storagePath, a.sha256, a.bytes, a.role],
      );
    }

    let reviewUrl: string | undefined;
    // 5. If PR or review requested, upsert review
    if (payload.pullRequestNumber || payload.evidenceDigest) {
      const reviewStore = new ReviewStore(executor);
      const evidenceDigest = payload.evidenceDigest ?? "0".repeat(64);
      const title = payload.title ?? `Review for PR #${payload.pullRequestNumber ?? payload.commitSha.slice(0, 7)}`;
      const reviewResult = await reviewStore.upsertReviewForRun({
        repositoryId,
        ...(payload.pullRequestNumber !== undefined ? { pullRequestNumber: payload.pullRequestNumber } : {}),
        title,
        headRunId: runId,
        headCommitSha: payload.commitSha,
        ...(payload.baseRunId !== undefined ? { baseRunId: payload.baseRunId } : {}),
        ...(payload.baseCommitSha !== undefined ? { baseCommitSha: payload.baseCommitSha } : {}),
        evidenceDigest,
        createdBy: auth.actorId,
      });

      reviewUrl = `/reviews/${reviewResult.review.id}`;
    }

    return Response.json(
      {
        ok: true,
        runId,
        status: "completed",
        decision,
        ...(reviewUrl ? { reviewUrl } : {}),
      },
      { status: 201 },
    );
  } finally {
    await executor.close();
  }
}
