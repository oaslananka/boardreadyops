import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as postRun } from "../../apps/web/app/api/v1/runs/route.js";
import * as apiAuth from "../../apps/web/lib/api-auth.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const database = connectionString ? createPgQueryExecutor({ connectionString }) : undefined;
const suite = connectionString ? describe : describe.skip;
const installationId = randomUUID();
const repositoryId = randomUUID();
const commitSha = "a".repeat(40);
const svg = '<svg viewBox="0 0 279.4 115.6"><rect width="279.4" height="115.6"/></svg>';
const image = {
  id: "native-f-cu",
  name: "native-f-cu.svg",
  kind: "pcb_layer",
  format: "svg",
  sheetOrLayer: "F.Cu",
  width: 279.4,
  height: 115.6,
  content: svg,
  sha256: "b".repeat(64),
  anchors: [],
};

async function query(sql: string, params: unknown[] = []) {
  if (!database) throw new Error("Disposable PostgreSQL database is not configured");
  return (await database.query(sql, params)) as { rows: Record<string, unknown>[] };
}

function publishRequest(key: string, overrides: Record<string, unknown> = {}) {
  return new Request("https://boardreadyops.test/api/v1/runs", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({
      repositoryId,
      commitSha,
      ref: "refs/heads/main",
      triggerKind: "manual",
      snapshots: [image],
      ...overrides,
    }),
  });
}

suite("atomic run/snapshot/Review ingestion on disposable PostgreSQL", () => {
  beforeAll(async () => {
    await query(
      `INSERT INTO installations(id, github_installation_id, account_login, account_type)
       VALUES ($1, 971167, 'atomic-publish-fixture', 'Organization')`,
      [installationId],
    );
    await query(
      `INSERT INTO repositories(id, installation_id, github_repo_id, owner, name, default_branch, private)
       VALUES ($1, $2, 97116701, 'atomic-publish-fixture', 'pcb-review', 'main', false)`,
      [repositoryId, installationId],
    );
    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
      ok: true,
      repositoryId,
      actorId: "atomic-publish-test",
      scopes: ["runs:write"],
      authType: "bearer_token",
    });
    vi.spyOn(apiAuth, "resolveRepositoryApiContext").mockImplementation(async () => ({
      repositoryId,
      executor: createPgQueryExecutor({ connectionString: connectionString ?? "" }),
    }));
  });

  afterAll(async () => {
    try {
      await query("DELETE FROM release_runs WHERE repository_id=$1", [repositoryId]);
      await query("DELETE FROM repositories WHERE id=$1", [repositoryId]);
      await query("DELETE FROM installations WHERE id=$1", [installationId]);
    } finally {
      await database?.close();
      vi.restoreAllMocks();
    }
  });

  it("commits rounded SQL dimensions while retaining exact SVG and idempotency", async () => {
    const key = `accepted-${randomUUID()}`;
    const first = await postRun(publishRequest(key));
    expect(first.status).toBe(201);
    const { runId } = (await first.json()) as { runId: string };
    const rows = await query("SELECT width, height, content FROM run_snapshots WHERE run_id=$1", [runId]);
    expect(rows.rows).toMatchObject([{ width: 280, height: 116, content: svg }]);
    const second = await postRun(publishRequest(key));
    expect(second.status).toBe(200);
    expect(((await second.json()) as { deduplicated: boolean }).deduplicated).toBe(true);
    const count = await query("SELECT COUNT(*)::int AS total FROM release_runs WHERE idempotency_key=$1", [key]);
    expect(count.rows[0]?.total).toBe(1);
  });

  it("commits the Review and its native snapshot in one transaction", async () => {
    const key = `approved-review-${randomUUID()}`;
    const response = await postRun(
      publishRequest(key, {
        evidenceDigest: "e".repeat(64),
        title: "Verified native design acceptance",
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { reviewUrl: string; runId: string };
    expect(body.reviewUrl).toMatch(/^\/reviews\/[0-9a-f-]{36}$/u);
    const reviews = await query("SELECT COUNT(*)::int AS total FROM reviews WHERE head_run_id=$1", [body.runId]);
    expect(reviews.rows[0]?.total).toBe(1);
    const images = await query("SELECT COUNT(*)::int AS total FROM run_snapshots WHERE run_id=$1", [body.runId]);
    expect(images.rows[0]?.total).toBe(1);
  });

  it("rolls back the run and findings when the snapshot violates the SHA-256 SQL check", async () => {
    const key = `bad-image-${randomUUID()}`;
    await expect(
      postRun(
        publishRequest(key, {
          snapshots: [{ ...image, sha256: "Z".repeat(64) }],
          findings: [{ ruleId: "drc.clearance", severity: "error", message: "atomic-publish-test-finding" }],
        }),
      ),
    ).rejects.toThrow();
    const runs = await query("SELECT COUNT(*)::int AS total FROM release_runs WHERE idempotency_key=$1", [key]);
    expect(runs.rows[0]?.total).toBe(0);
    const findings = await query(
      "SELECT COUNT(*)::int AS total FROM findings WHERE message='atomic-publish-test-finding'",
    );
    expect(findings.rows[0]?.total).toBe(0);
  });

  it("rolls back inserted snapshots if the Review references a nonexistent base run", async () => {
    const key = `bad-review-${randomUUID()}`;
    await expect(
      postRun(
        publishRequest(key, {
          evidenceDigest: "f".repeat(64),
          baseRunId: randomUUID(),
        }),
      ),
    ).rejects.toThrow();
    const runs = await query("SELECT COUNT(*)::int AS total FROM release_runs WHERE idempotency_key=$1", [key]);
    expect(runs.rows[0]?.total).toBe(0);
    const images = await query("SELECT COUNT(*)::int AS total FROM run_snapshots WHERE snapshot_id=$1", [image.id]);
    expect(images.rows[0]?.total).toBe(2); // Only the two fully committed requests remain.
  });
});
