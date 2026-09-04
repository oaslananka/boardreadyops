import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DELETE as linkDelete } from "../../apps/web/app/api/v1/external-review-links/[linkId]/route.js";
import { GET as linksGet, POST as linksPost } from "../../apps/web/app/api/v1/external-review-links/route.js";
import { ApiTokenStore } from "../../packages/db/src/api-token-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { ReviewStore } from "../../packages/db/src/review-store.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;

const installationId = "9e000000-0000-4000-8000-000000000201";
const repositoryId = "9e000000-0000-4000-8000-000000000211";
const runId = "9e000000-0000-4000-8000-000000000221";
const githubInstallationId = 49_401;
const githubRepoId = 49_411;

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

describeDatabase("external review links API (real Postgres)", () => {
  let reviewId: string;
  let token: string;

  beforeAll(async () => {
    if (!executor) return;
    await database().query("delete from installations where id = $1", [installationId]);
    await database().query(
      `insert into installations (id, github_installation_id, account_login, account_type, plan_tier)
       values ($1, $2, 'ext-review-org', 'Organization', 'team')`,
      [installationId, githubInstallationId],
    );
    await database().query(
      `insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch)
       values ($1, $2, $3, 'ext-review-org', 'gateway-board', true, 'main')`,
      [repositoryId, installationId, githubRepoId],
    );
    await database().query(
      `insert into release_runs (id, repository_id, commit_sha, ref, trigger_kind, status)
       values ($1, $2, 'c1d2e3f4', 'refs/heads/main', 'push', 'completed')`,
      [runId, repositoryId],
    );

    const reviewStore = new ReviewStore(database());
    const { review } = await reviewStore.upsertReviewForRun({
      repositoryId,
      title: "External review link integration test",
      headRunId: runId,
      headCommitSha: "c1d2e3f4c1d2e3f4",
      evidenceDigest: "c".repeat(64),
    });
    reviewId = review.id;

    const tokenStore = new ApiTokenStore(database());
    const created = await tokenStore.createToken({
      repositoryId,
      name: "ext-review-links-test-token",
      scopes: ["reviews:read", "reviews:write"],
    });
    token = created.token;
  });

  afterAll(async () => {
    if (!executor) return;
    await database().query("delete from installations where id = $1", [installationId]);
    await executor.close();
  });

  it("creates a link, returns the raw token once, lists it, then revokes it", async () => {
    const createRequest = new Request("https://boardreadyops.com/api/v1/external-review-links", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        reviewId,
        recipientEmail: "external.reviewer@vendor.example",
        recipientName: "External Reviewer",
        scope: "comment_only",
      }),
    });
    const createRes = await linksPost(createRequest);
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      ok: boolean;
      invitation: { id: string; reviewId: string; tokenHash: string };
      token: string;
    };
    expect(created.ok).toBe(true);
    expect(created.invitation.reviewId).toBe(reviewId);
    expect(created.token).toMatch(/^bro_ext_/);
    // The raw token must never be derivable from what's persisted.
    expect(created.invitation.tokenHash).not.toBe(created.token);

    const listRequest = new Request(`https://boardreadyops.com/api/v1/external-review-links?reviewId=${reviewId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const listRes = await linksGet(listRequest);
    const listed = (await listRes.json()) as { ok: boolean; invitations: Array<{ id: string }> };
    expect(listed.ok).toBe(true);
    expect(listed.invitations.map((i) => i.id)).toContain(created.invitation.id);

    const deleteRequest = new Request(
      `https://boardreadyops.com/api/v1/external-review-links/${created.invitation.id}`,
      { method: "DELETE", headers: { authorization: `Bearer ${token}` } },
    );
    const deleteRes = await linkDelete(deleteRequest, { params: Promise.resolve({ linkId: created.invitation.id }) });
    expect(deleteRes.status).toBe(200);

    const secondDeleteRes = await linkDelete(deleteRequest, {
      params: Promise.resolve({ linkId: created.invitation.id }),
    });
    expect(secondDeleteRes.status).toBe(404);
  });

  it("rejects creating a link on the free plan", async () => {
    const freeInstallationId = "9e000000-0000-4000-8000-000000000202";
    const freeRepositoryId = "9e000000-0000-4000-8000-000000000212";
    const freeRunId = "9e000000-0000-4000-8000-000000000222";
    try {
      await database().query(
        `insert into installations (id, github_installation_id, account_login, account_type, plan_tier)
         values ($1, $2, 'ext-review-org-free', 'Organization', 'free')`,
        [freeInstallationId, githubInstallationId + 1],
      );
      await database().query(
        `insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch)
         values ($1, $2, $3, 'ext-review-org-free', 'gateway-board-free', true, 'main')`,
        [freeRepositoryId, freeInstallationId, githubRepoId + 1],
      );
      await database().query(
        `insert into release_runs (id, repository_id, commit_sha, ref, trigger_kind, status)
         values ($1, $2, 'f1e2d3c4', 'refs/heads/main', 'push', 'completed')`,
        [freeRunId, freeRepositoryId],
      );
      const reviewStore = new ReviewStore(database());
      const { review: freeReview } = await reviewStore.upsertReviewForRun({
        repositoryId: freeRepositoryId,
        title: "Free plan external review link test",
        headRunId: freeRunId,
        headCommitSha: "f1e2d3c4f1e2d3c4",
        evidenceDigest: "d".repeat(64),
      });

      const tokenStore = new ApiTokenStore(database());
      const freeCreated = await tokenStore.createToken({
        repositoryId: freeRepositoryId,
        name: "ext-review-links-free-test-token",
        scopes: ["reviews:read", "reviews:write"],
      });

      const request = new Request("https://boardreadyops.com/api/v1/external-review-links", {
        method: "POST",
        headers: { authorization: `Bearer ${freeCreated.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          reviewId: freeReview.id,
          recipientEmail: "external.reviewer@vendor.example",
          recipientName: "External Reviewer",
          scope: "read_only",
        }),
      });
      const res = await linksPost(request);
      expect(res.status).toBe(403);
    } finally {
      await database().query("delete from installations where id = $1", [freeInstallationId]);
    }
  });

  it("rejects creating a link for a review outside the caller's repository", async () => {
    const request = new Request("https://boardreadyops.com/api/v1/external-review-links", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        reviewId: "00000000-0000-4000-8000-000000000000",
        recipientEmail: "external.reviewer@vendor.example",
        recipientName: "External Reviewer",
        scope: "read_only",
      }),
    });
    const res = await linksPost(request);
    expect(res.status).toBe(404);
  });
});
