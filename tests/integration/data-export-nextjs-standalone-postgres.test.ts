import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stageClaimedDurableLocalArchiveCommitment } from "../../apps/web/lib/data-export-local-archive.js";
import { encodeUserSession } from "../../apps/web/lib/user-session.js";
import { DataExportArchiveCommitmentStore } from "../../packages/db/src/data-export-archive-commitment-store.js";
import { DataExportPreparationStore } from "../../packages/db/src/data-export-preparation-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const enabled = process.env.BOARDREADYOPS_NEXT_STANDALONE_TESTS === "true" && Boolean(connectionString);
const describeRuntime = enabled ? describe : describe.skip;
const db = connectionString ? createPgQueryExecutor({ connectionString, max: 5 }) : undefined;
const standaloneRoot = path.resolve("apps/web/.next/standalone");
const serverFile = path.join(standaloneRoot, "apps/web/server.js");
const secret = "boardreadyops-test-only-signed-session-key-2026-11-05";
const tenant = `testarch-${randomUUID().slice(0, 8)}`;
const installationId = randomUUID();
const repositoryId = randomUUID();
const githubInstallationId = Number.parseInt(randomUUID().slice(0, 8), 16);
const requester = "archive-requester";
let storageRoot = "";
let privateArchiveRoot = "";
let baseURL = "";
let child: ChildProcess | undefined;
let stdio = "";
const exportIds: string[] = [];

function executor() {
  if (!db) throw new Error("Disposable PostgreSQL is required");
  return db;
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port reserved");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

function sessionCookie(login = requester, installationIds = [githubInstallationId], userId = 12) {
  const now = new Date();
  const token = encodeUserSession(
    {
      userId,
      login,
      installationIds,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3600_000).toISOString(),
    },
    secret,
  );
  return `brops_session=${token}`;
}

async function stagedExport(largeArtifactBytes = 0) {
  if (largeArtifactBytes > 0) {
    // Incompressible bounded source makes a real disconnect occur while ZIP
    // bytes are still being transmitted; tiny metadata fixtures are too fast.
    const runId = randomUUID();
    const artifactId = randomUUID();
    const objectName = `objects/${artifactId}.bin`;
    const payload = randomBytes(largeArtifactBytes);
    await mkdir(path.join(storageRoot, "objects"), { recursive: true });
    await writeFile(path.join(storageRoot, objectName), payload, { mode: 0o600 });
    await executor().query(
      "INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status) VALUES($1,$2,$3,'refs/heads/main','manual','completed')",
      [runId, repositoryId, "d".repeat(40)],
    );
    await executor().query(
      `INSERT INTO artifacts(id,run_id,kind,name,role,storage_path,sha256,bytes,content_type,retention_until)
       VALUES($1,$2,'manufacturing','test-payload.bin','package',$3,$4,$5,'application/octet-stream',NOW()+INTERVAL '1 day')`,
      [artifactId, runId, objectName, createHash("sha256").update(payload).digest("hex"), payload.byteLength],
    );
    payload.fill(0);
  }
  const store = new DataExportPreparationStore(executor());
  const exportId = await store.createBoundPendingExport({
    tenantId: tenant,
    installationId,
    requestedBy: requester,
    scope: "repository",
    scopeId: repositoryId,
  });
  if (!exportId) throw new Error("Expected repository-scoped export");
  exportIds.push(exportId);
  const claim = await store.claimNext({ installationId, workerId: "runtime-acceptance" });
  if (!claim || claim.exportId !== exportId) throw new Error("Expected authorized lease");
  const staged = await stageClaimedDurableLocalArchiveCommitment({
    db: executor(),
    claim: { exportId, tenantId: tenant, installationId, workerId: claim.workerId, token: claim.token },
    storageRoot,
    storageDriver: "local",
    privateArchiveRoot,
  });
  if (!staged) throw new Error("Expected durable verified ZIP");
  return { exportId, staged };
}

function downloadURL(exportId: string) {
  return `${baseURL}/api/v1/data-exports/${exportId}?installationId=${installationId}&download=archive`;
}

beforeAll(async () => {
  if (!enabled) return;
  if (!(await stat(serverFile).catch(() => null))?.isFile()) {
    throw new Error("Build web standalone before running this explicit integration test");
  }
  storageRoot = await mkdtemp(path.join(tmpdir(), "bro44-nextjs-storage-"));
  privateArchiveRoot = await mkdtemp(path.join(tmpdir(), "bro44-nextjs-private-"));
  await chmod(storageRoot, 0o700);
  await chmod(privateArchiveRoot, 0o700);

  await executor().query(
    "INSERT INTO installations(id,github_installation_id,account_login,account_type) VALUES($1,$2,$3,'Organization')",
    [installationId, githubInstallationId, tenant],
  );
  await executor().query(
    "INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch) VALUES($1,$2,$3,$4,'local-test','main')",
    [repositoryId, installationId, githubInstallationId + 1, tenant],
  );

  const port = await reservePort();
  baseURL = `http://127.0.0.1:${port}`;
  const serverProcess = spawn(process.execPath, [serverFile], {
    cwd: standaloneRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: connectionString ?? "",
      SESSION_SECRET: secret,
      ARTIFACT_STORAGE_ROOT: storageRoot,
      BOARDREADYOPS_PRIVATE_EXPORT_ARCHIVE_ROOT: privateArchiveRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = serverProcess;
  serverProcess.stdout.on("data", (chunk: Buffer) => {
    stdio = (stdio + chunk.toString()).slice(-4000);
  });
  serverProcess.stderr.on("data", (chunk: Buffer) => {
    stdio = (stdio + chunk.toString()).slice(-4000);
  });
  for (let attempt = 0; attempt < 40; attempt++) {
    if (serverProcess.exitCode !== null) throw new Error(`Standalone server exited: ${stdio}`);
    try {
      const response = await fetch(`${baseURL}/api/health`);
      if (response.ok) return;
    } catch {
      /* Wait for localhost bind. */
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Standalone server never became healthy: ${stdio}`);
}, 18_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    const worker = child;
    worker.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => worker.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (worker.exitCode === null) worker.kill("SIGKILL");
  }
  if (db) await db.close();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  if (privateArchiveRoot) await rm(privateArchiveRoot, { recursive: true, force: true });
}, 12_000);

describeRuntime("real Next.js standalone private ZIP transport with disposable PG17", () => {
  it("authenticates a historical user export with the original numeric OAuth ID and no live installation", async () => {
    const historicalId = randomUUID();
    const formerLogin = "former-" + randomUUID().slice(0, 8);
    await executor().query(
      "INSERT INTO data_exports(id,tenant_id,requested_by,status,scope,scope_id,original_github_user_id,download_url) VALUES ($1,$2,'github_app_uninstall','pending','user',$2,12,'https://invalid.example/legacy-secret')",
      [historicalId, formerLogin],
    );
    const url = baseURL + "/api/v1/historical-user-exports/" + historicalId;
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers: { cookie: sessionCookie(formerLogin, [], 13) } })).status).toBe(404);
    const authorized = await fetch(url, { headers: { cookie: sessionCookie("renamed-owner", [], 12) } });
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("cache-control")).toBe("private, no-store");
    const payload = await authorized.json();
    expect(payload).toMatchObject({
      ok: true,
      export: {
        id: historicalId,
        scope: "user",
        status: "pending",
        downloadAvailable: false,
      },
    });
    expect(JSON.stringify(payload)).not.toContain("legacy-secret");
    expect(JSON.stringify(payload)).not.toContain(formerLogin);
    expect(
      (
        await fetch(url + "?download=archive", {
          headers: { cookie: sessionCookie("renamed-owner", [], 12) },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(url, {
          headers: { cookie: sessionCookie("renamed-owner", [], 12), origin: "https://untrusted.example" },
        })
      ).status,
    ).toBe(403);
    await executor().query(
      "INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,scope_id,status,dry_run,completed_at) VALUES ($1,$2,'github_app_uninstall','user',$2,'completed',FALSE,NOW())",
      [randomUUID(), formerLogin],
    );
    expect(
      (
        await fetch(url, {
          headers: { cookie: sessionCookie("renamed-owner", [], 12) },
        })
      ).status,
    ).toBe(404);
  });

  it("denies unauthenticated, other-requester and cross-site ZIP reads", async () => {
    const { exportId } = await stagedExport();
    const url = downloadURL(exportId);
    const unauthenticated = await fetch(url);
    expect(unauthenticated.status).toBe(401);
    const other = await fetch(url, { headers: { cookie: sessionCookie("unrelated-user") } });
    expect(other.status).toBe(404);
    const crossSite = await fetch(url, {
      headers: { cookie: sessionCookie(), origin: "https://untrusted.example" },
    });
    expect(crossSite.status).toBe(403);
    const range = await fetch(url, {
      headers: { cookie: sessionCookie(), range: "bytes=0-1" },
    });
    expect(range.status).toBe(416);
    const foreignInstallation = await fetch(url, {
      headers: { cookie: sessionCookie(requester, [githubInstallationId + 4000]) },
    });
    expect(foreignInstallation.status).toBe(403);
  });

  it("rejects a tampered private ZIP without returning any ZIP response bytes", async () => {
    const { exportId, staged } = await stagedExport();
    const target = path.join(privateArchiveRoot, `${exportId}.zip`);
    await writeFile(target, Buffer.alloc(staged.byteLength, 0x42));
    const response = await fetch(downloadURL(exportId), {
      headers: { cookie: sessionCookie() },
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).not.toContain("application/zip");
    const denial = await response.json();
    expect(denial).toEqual({ ok: false, error: "not found" });
    const events = await executor().query(
      "SELECT event_type FROM audit_events WHERE installation_id=$1 AND subject_id=$2",
      [installationId, exportId],
    );
    expect((events as { rows: Array<{ event_type: string }> }).rows.map((row) => row.event_type)).toEqual([
      "data_export.archive.staged",
    ]);
  });

  it("rolls back the original requester read on an actual authenticated Next.js socket disconnect", async () => {
    const { exportId, staged } = await stagedExport(4 * 1024 * 1024);
    expect(staged.byteLength).toBeGreaterThan(4 * 1024 * 1024);
    const observed = await new Promise<number>((resolve, reject) => {
      const request = get(downloadURL(exportId), { headers: { cookie: sessionCookie() } }, (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Expected authenticated ZIP status 200, got ${response.statusCode}`));
          return;
        }
        response.once("data", (chunk: Buffer) => {
          const received = chunk.byteLength;
          response.destroy();
          resolve(received);
        });
        response.once("error", reject);
        response.once("end", () => reject(new Error("Response finished before disconnect")));
      });
      request.once("error", reject);
    });
    expect(observed).toBeGreaterThan(0);
    expect(observed).toBeLessThan(staged.byteLength);
    const revoked = await Promise.race([
      new DataExportArchiveCommitmentStore(executor()).revokeForRequester({
        exportId,
        tenantId: tenant,
        installationId,
        actorLogin: requester,
      }),
      new Promise<"stalled">((resolve) => setTimeout(() => resolve("stalled"), 8_000)),
    ]);
    expect(revoked).toBe(true);
    const events = await executor().query(
      "SELECT event_type FROM audit_events WHERE installation_id=$1 AND subject_id=$2 ORDER BY created_at,id",
      [installationId, exportId],
    );
    expect((events as { rows: Array<{ event_type: string }> }).rows.map((row) => row.event_type)).toEqual([
      "data_export.archive.staged",
      "data_export.archive.revoked",
    ]);
  }, 15_000);

  it("delivers a fully verified private ZIP and then admits requester revocation", async () => {
    const { exportId, staged } = await stagedExport();
    const response = await fetch(downloadURL(exportId), { headers: { cookie: sessionCookie() } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("application/zip");
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.byteLength).toBe(staged.byteLength);
    expect(createHash("sha256").update(body).digest("hex")).toBe(staged.sha256);
    // The HTTP body may finish before the asynchronous PostgreSQL COMMIT.
    // Requester revocation must serialize on the same commitment row lock.
    // Only then assert that the completed read audit is durable.
    expect(
      await new DataExportArchiveCommitmentStore(executor()).revokeForRequester({
        exportId,
        tenantId: tenant,
        installationId,
        actorLogin: requester,
      }),
    ).toBe(true);
    const read = await executor().query(
      "SELECT event_type FROM audit_events WHERE installation_id=$1 AND subject_id=$2 ORDER BY created_at,id",
      [installationId, exportId],
    );
    expect((read as { rows: Array<{ event_type: string }> }).rows.map((row) => row.event_type)).toEqual([
      "data_export.archive.staged",
      "data_export.archive.read_verified",
      "data_export.archive.revoked",
    ]);
    const afterRevoke = await fetch(downloadURL(exportId), { headers: { cookie: sessionCookie() } });
    expect(afterRevoke.status).toBe(404);
  });
});
