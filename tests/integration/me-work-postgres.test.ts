import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as meWorkGet } from "../../apps/web/app/api/v1/me/work/route.js";
import { ApiTokenStore } from "../../packages/db/src/api-token-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { ReviewStore } from "../../packages/db/src/review-store.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;

const installationId = "9e000000-0000-4000-8000-000000000101";
const repositoryId = "9e000000-0000-4000-8000-000000000111";
const runId = "9e000000-0000-4000-8000-000000000121";
const githubInstallationId = 49_301;
const githubRepoId = 49_311;
const findingFingerprint = "f".repeat(64);
const assignee = "octocat-assignee";

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

describeDatabase("GET /api/v1/me/work (real Postgres)", () => {
  let reviewId: string;

  beforeAll(async () => {
    if (!executor) return;
    await database().query("delete from installations where id = $1", [installationId]);
    await database().query(
      `insert into installations (id, github_installation_id, account_login, account_type)
       values ($1, $2, 'me-work-org', 'Organization')`,
      [installationId, githubInstallationId],
    );
    await database().query(
      `insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch)
       values ($1, $2, $3, 'me-work-org', 'gateway-board', true, 'main')`,
      [repositoryId, installationId, githubRepoId],
    );
    await database().query(
      `insert into release_runs (id, repository_id, commit_sha, ref, trigger_kind, status)
       values ($1, $2, 'a1b2c3d4', 'refs/heads/main', 'push', 'completed')`,
      [runId, repositoryId],
    );
    await database().query(
      `insert into findings (id, run_id, rule_id, severity, message, path, fingerprint)
       values (gen_random_uuid()::text, $1, 'kicad/track-clearance', 'error', 'Clearance violation', 'board.kicad_pcb', $2)`,
      [runId, findingFingerprint],
    );

    const reviewStore = new ReviewStore(database());
    const { review } = await reviewStore.upsertReviewForRun({
      repositoryId,
      title: "My Work integration test review",
      headRunId: runId,
      headCommitSha: "a1b2c3d4a1b2c3d4",
      evidenceDigest: "b".repeat(64),
    });
    reviewId = review.id;

    await database().query(
      `insert into finding_assignments (id, repository_id, review_id, finding_fingerprint, assignee, assigned_by)
       values (gen_random_uuid()::text, $1, $2, $3, $4, 'test-runner')`,
      [repositoryId, reviewId, findingFingerprint, assignee],
    );
  });

  afterAll(async () => {
    if (!executor) return;
    await database().query("delete from installations where id = $1", [installationId]);
    await executor.close();
  });

  it("returns the caller's cross-repository open assigned findings by bearer token identity", async () => {
    const store = new ApiTokenStore(database());
    const { token, record } = await store.createToken({
      repositoryId,
      name: "me-work-test-token",
      scopes: ["reviews:read"],
    });
    await database().query("update finding_assignments set assignee = $1 where review_id = $2", [record.id, reviewId]);

    const request = new Request("https://boardreadyops.com/api/v1/me/work", {
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await meWorkGet(request);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      assignedFindings: Array<{ fingerprint: string; ruleId: string; repositoryId: string; reviewId: string }>;
    };

    expect(body.ok).toBe(true);
    expect(body.assignedFindings).toHaveLength(1);
    expect(body.assignedFindings[0]).toMatchObject({
      fingerprint: findingFingerprint,
      ruleId: "kicad/track-clearance",
      repositoryId,
      reviewId,
    });
  });

  it("also returns awaiting/changes-requested reviews when a repositoryId is provided", async () => {
    const store = new ApiTokenStore(database());
    const { token } = await store.createToken({
      repositoryId,
      name: "me-work-repo-scope-token",
      scopes: ["reviews:read"],
    });

    const request = new Request(`https://boardreadyops.com/api/v1/me/work?repositoryId=${repositoryId}`, {
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await meWorkGet(request);
    const body = (await res.json()) as { ok: boolean; awaitingReviews: unknown[]; scopedToRepository: string | null };

    expect(body.ok).toBe(true);
    expect(body.scopedToRepository).toBe(repositoryId);
    expect(body.awaitingReviews.length).toBeGreaterThanOrEqual(1);
  });
});
