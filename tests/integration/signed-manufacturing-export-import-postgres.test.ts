import { execFileSync } from "node:child_process";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { handleResultRequest } from "../../apps/web/app/api/v1/runs/result/route.js";
import {
  handleSignedManufacturingExportImport,
  type SignedExportImportDependencies,
} from "../../apps/web/lib/signed-manufacturing-export-import.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";
import { startLostPostgresReplyProxy } from "../helpers/lost-postgres-reply-proxy.js";

const databaseUrl = getPostgresTestConnectionString();
const describePg = databaseUrl ? describe : describe.skip;
const db = databaseUrl ? createPgQueryExecutor({ connectionString: databaseUrl, max: 3 }) : undefined;

afterAll(async () => {
  await db?.close();
});

async function filesBelow(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else files.push(full);
    }
  }
  await visit(root);
  return files;
}

async function syntheticArchive(root: string): Promise<Buffer> {
  const source = path.join(root, "source");
  const manifest = path.join(source, "build", "boardreadyops-attested");
  await mkdir(manifest, { recursive: true });
  await writeFile(path.join(manifest, "manifest.json"), JSON.stringify({ fixture: true }));
  await writeFile(path.join(source, "bundle.sigstore.json"), JSON.stringify({ signed: true }));
  const destination = path.join(root, "synthetic.tar.gz");
  execFileSync("tar", ["-czf", destination, "-C", source, "build", "bundle.sigstore.json"]);
  return await readFile(destination);
}

describePg("signed export HTTP bytes after real PostgreSQL TCP acknowledgement loss", () => {
  it("retains archive and tenant-bound evidence, rejects replay without duplicating files", async () => {
    if (!db || !databaseUrl) throw new Error("isolated PostgreSQL database required");
    const installationId = randomUUID();
    const repositoryRecordId = randomUUID();
    const runId = randomUUID();
    const attemptId = randomUUID();
    const githubRepositoryId = randomInt(1_000_000_000, 2_000_000_000);
    const githubRunId = String(randomInt(1_000_000_000, 2_000_000_000));
    const repository = "synthetic/hardware-board";
    const sourceSha = "a".repeat(40);
    const signerSha = "b".repeat(40);
    const now = new Date("2026-11-03T00:00:00.000Z");
    const temp = await mkdtemp(path.join(os.tmpdir(), "bro-http-pg-drop-"));
    const storage = path.join(temp, "stored");
    let proxy: Awaited<ReturnType<typeof startLostPostgresReplyProxy>> | undefined;
    let interrupted: ReturnType<typeof createPgQueryExecutor> | undefined;
    try {
      await db.query(
        "insert into installations (id, github_installation_id, account_login, account_type) values ($1,$2,'synthetic-test','Organization')",
        [installationId, randomInt(1_000_000_000, 2_000_000_000)],
      );
      await db.query(
        "insert into repositories (id, installation_id, github_repo_id, owner, name, private, default_branch) values ($1,$2,$3,'synthetic','hardware-board',true,'main')",
        [repositoryRecordId, installationId, githubRepositoryId],
      );
      await db.query(
        "insert into release_runs (id,repository_id,commit_sha,ref,trigger_kind,status,started_at,execution_attempt_id,execution_attempt_started_at) values ($1,$2,$3,'refs/heads/main','push','running',$4::timestamptz,$5,$4::timestamptz)",
        [runId, repositoryRecordId, sourceSha, now.toISOString(), attemptId],
      );
      await db.query(
        "insert into release_run_attempts (id,run_id,attempt_number,status,created_at,dispatch_requested_at,dispatched_at,started_at,github_workflow_dispatch_id) values ($1,$2,2,'in_progress',$3::timestamptz,$3::timestamptz,$3::timestamptz,$3::timestamptz,$4)",
        [attemptId, runId, now.toISOString(), githubRunId],
      );
      const archive = await syntheticArchive(temp);
      const sha256 = createHash("sha256").update(archive).digest("hex");
      proxy = await startLostPostgresReplyProxy(databaseUrl, "boardreadyops_record_signed_manufacturing_export");
      interrupted = createPgQueryExecutor({ connectionString: proxy.connectionString, max: 1 });
      const lostReplyConnection = interrupted;
      const expected = {
        runId,
        executionAttemptId: attemptId,
        repositoryRecordId,
        installationId,
        attemptNumber: 2,
        workflowPath: ".github/workflows/readiness-runner.yml",
        repository,
        repositoryId: String(githubRepositoryId),
        githubRunId,
        runAttempt: 1,
        targetSha: sourceSha,
        workflowRef: `${repository}/.github/workflows/readiness-runner.yml@refs/heads/main`,
        ref: "refs/heads/main",
        audience: ["boardreadyops-cloud", runId, attemptId, sourceSha, "standard", "none"].join(":"),
        trustMode: "standard" as const,
        safeModeReasons: [],
      };
      let interruptWrite = true;
      const dependencies: SignedExportImportDependencies = {
        environment: { ARTIFACT_STORAGE_ROOT: storage, ARTIFACT_STORAGE_DRIVER: "local" },
        queryExecutor: () => ({
          query: async (sql, params = []) =>
            interruptWrite && sql.includes("boardreadyops_record_signed_manufacturing_export")
              ? lostReplyConnection.query(sql, params)
              : db.query(sql, params),
        }),
        loadExpectedRun: async (executor, rid, aid) => {
          const active = (await executor.query(
            "select r.id from release_runs r join release_run_attempts a on a.run_id=r.id where r.id=$1 and a.id=$2 and r.execution_attempt_id=a.id and r.status='running'",
            [rid, aid],
          )) as { rows: unknown[] };
          return active.rows.length === 1 ? expected : undefined;
        },
        verifyOidc: async () => ({
          workflowSha: signerSha,
          workflowRunId: githubRunId,
          runAttempt: 1,
          repository,
          repositoryId: String(githubRepositoryId),
          workflowRef: expected.workflowRef,
          ref: "refs/heads/main",
          event: "workflow_dispatch",
          runnerEnvironment: "github-hosted",
        }),
        verifyArchive: async () => ({ status: "eligible" as const, reason: "synthetic-fixture", subjects: 29 }),
        now: () => now,
        id: randomUUID,
      };
      const request = () =>
        new Request(`https://boardreadyops.test/api/v1/runs/${runId}/attempts/${attemptId}/manufacturing-export`, {
          method: "POST",
          headers: {
            authorization: "Bearer synthetic.github.oidc",
            "content-type": "application/gzip",
          },
          body: new Uint8Array(archive),
        });
      const response = await handleSignedManufacturingExportImport(request(), { runId, attemptId }, dependencies);
      expect(response.status).toBe(503);
      expect(proxy.droppedReply()).toBe(true);

      const evidence = (await db.query(
        "select e.installation_id,e.repository_id,e.source_sha,e.signer_sha,e.github_run_id,a.storage_path,a.sha256,a.bytes from signed_manufacturing_export_evidence e join artifacts a on a.id=e.artifact_id where e.run_id=$1 and e.execution_attempt_id=$2",
        [runId, attemptId],
      )) as { rows: Array<Record<string, unknown>> };
      expect(evidence.rows).toHaveLength(1);
      expect(evidence.rows[0]).toMatchObject({
        installation_id: installationId,
        repository_id: repositoryRecordId,
        source_sha: sourceSha,
        signer_sha: signerSha,
        github_run_id: githubRunId,
        sha256,
        bytes: archive.length,
      });
      const storedFiles = await filesBelow(storage);
      expect(storedFiles).toHaveLength(1);
      const stored = storedFiles[0];
      if (!stored) throw new Error("archive missing after acknowledged SQL commit");
      expect(path.relative(storage, stored).split(path.sep).join("/")).toBe(evidence.rows[0]?.storage_path);
      const persisted = await readFile(stored);
      expect(persisted).toEqual(archive);
      expect(createHash("sha256").update(persisted).digest("hex")).toBe(sha256);

      interruptWrite = false;
      const retry = await handleSignedManufacturingExportImport(request(), { runId, attemptId }, dependencies);
      expect(retry.status).toBe(409);
      expect(await filesBelow(storage)).toEqual([stored]);
      const count = (await db.query(
        "select count(*)::integer as count from signed_manufacturing_export_evidence where run_id=$1",
        [runId],
      )) as { rows: Array<{ count: number }> };
      expect(count.rows[0]?.count).toBe(1);
      // Regression: GitHub uploads the independently signed archive BEFORE its
      // terminal readiness callback. That callback must preserve the signed
      // archive and its immutable audit-event artifact reference.
      const terminalResponse = await handleResultRequest(
        new Request(`https://boardreadyops.test/api/v1/runs/result?run_id=${runId}&attempt_id=${attemptId}`, {
          method: "POST",
          headers: { authorization: "Bearer synthetic.github.oidc", "content-type": "application/json" },
          body: JSON.stringify({
            version: 1,
            executionAttemptId: attemptId,
            status: "completed",
            conclusion: "success",
            decision: "pass",
            findings: [],
            artifacts: [],
            metrics: { durationMs: 400, readinessScore: 100 },
            reportLinks: [],
          }),
        }),
        {
          queryExecutor: () => db,
          checkRunClient: () => undefined,
          detailsUrl: (id) => `https://boardreadyops.test/runs/${id}`,
          now: () => new Date(now.valueOf() + 5000),
          verifyOidcToken: async (_token, rid, aid) => rid === runId && aid === attemptId,
        },
      );
      expect(terminalResponse.status).toBe(202);
      const finalized = (await db.query(
        `select a.id, a.sha256, a.bytes, a.role, e.artifact_id, r.status,
                (select count(*)::int from audit_events where release_run_id = $1
                  and artifact_id = e.artifact_id and event_type = 'manufacturing.export.attested') as attestation_audits
           from signed_manufacturing_export_evidence e
           join artifacts a on a.id = e.artifact_id
           join release_runs r on r.id = e.run_id
          where e.run_id = $1 and e.execution_attempt_id = $2`,
        [runId, attemptId],
      )) as { rows: Array<Record<string, unknown>> };
      expect(finalized.rows).toHaveLength(1);
      expect(finalized.rows[0]).toMatchObject({
        artifact_id: finalized.rows[0]?.id,
        sha256,
        bytes: archive.length,
        role: "manufacturing",
        status: "completed",
        attestation_audits: 1,
      });
      expect(await readFile(stored)).toEqual(archive);
    } finally {
      await interrupted?.close();
      await proxy?.close();
      await db.query("delete from installations where id=$1", [installationId]);
      await rm(temp, { recursive: true, force: true });
    }
  }, 20_000);
});
