import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleSignedManufacturingExportImport,
  type SignedExportImportDependencies,
} from "../../../apps/web/lib/signed-manufacturing-export-import.js";

const runId = "5dc4193b-5c7e-4df8-b86f-e4d3266fc22d";
const attemptId = "7559e99b-4998-4e02-a94a-7a7a4686ae11";
const repoId = "987654321";
const targetSha = "a".repeat(40);
const signerSha = "b".repeat(40);
const runNumber = "29121986402";
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function archiveFixture(symlink = false): Promise<Uint8Array> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brops-import-fixture-"));
  roots.push(root);
  const exportRoot = path.join(root, "build/boardreadyops-attested");
  await fs.mkdir(exportRoot, { recursive: true });
  await fs.writeFile(path.join(exportRoot, "manifest.json"), JSON.stringify({ fixture: true }));
  await fs.writeFile(path.join(root, "bundle.sigstore.json"), JSON.stringify({ signed: true }));
  if (symlink) {
    await fs.symlink(path.join(root, "bundle.sigstore.json"), path.join(exportRoot, "linked.json"));
  }
  const archivePath = path.join(root, "upload.tar.gz");
  execFileSync("tar", ["-czf", archivePath, "-C", root, "build/", "bundle.sigstore.json"]);
  return new Uint8Array(await fs.readFile(archivePath));
}

function expectedRun() {
  return {
    runId,
    executionAttemptId: attemptId,
    repositoryRecordId: "repo-db-123",
    installationId: "installation-db-123",
    attemptNumber: 2,
    workflowPath: ".github/workflows/readiness-runner.yml",
    repository: "octo-org/hardware-board",
    repositoryId: repoId,
    githubRunId: runNumber,
    runAttempt: 1,
    targetSha,
    workflowRef: "octo-org/hardware-board/.github/workflows/readiness-runner.yml@refs/heads/main",
    ref: "refs/heads/main",
    audience: ["boardreadyops-cloud", runId, attemptId, targetSha, "standard", "none"].join(":"),
    trustMode: "standard" as const,
    safeModeReasons: [] as const,
  };
}

function claims() {
  return {
    workflowSha: signerSha,
    workflowRunId: runNumber,
    runAttempt: 1,
    repository: "octo-org/hardware-board",
    repositoryId: repoId,
    workflowRef: expectedRun().workflowRef,
    ref: "refs/heads/main",
    event: "workflow_dispatch",
    runnerEnvironment: "github-hosted",
  };
}

function dependencies(outcome = "accepted"): SignedExportImportDependencies & {
  query: ReturnType<typeof vi.fn>;
  verifyArchive: ReturnType<typeof vi.fn>;
  verifyOidc: ReturnType<typeof vi.fn>;
} {
  const root = path.join(os.tmpdir(), `brops-signed-export-storage-${randomUUID()}`);
  roots.push(root);
  const query = vi.fn(async () => ({ rows: [{ outcome }] }));
  const verifyArchive = vi.fn(async () => ({ status: "eligible" as const, reason: "verified", subjects: 29 }));
  const verifyOidc = vi.fn(async () => claims());
  return {
    environment: { ARTIFACT_STORAGE_ROOT: root, ARTIFACT_STORAGE_DRIVER: "local" },
    queryExecutor: () => ({ query }),
    loadExpectedRun: vi.fn(async () => expectedRun()),
    now: () => new Date("2026-11-03T00:00:00.000Z"),
    id: () => "e2dca950-85e0-4f7e-8d48-e5599d85a3a1",
    query,
    verifyArchive,
    verifyOidc,
    closeQueryExecutor: vi.fn(async () => undefined),
  };
}

function request(body: Uint8Array): Request {
  return new Request(`https://boardreadyops.test/api/v1/runs/${runId}/attempts/${attemptId}/manufacturing-export`, {
    method: "POST",
    headers: {
      authorization: "Bearer signed.github.oidc",
      "content-type": "application/gzip",
    },
    body,
  });
}

async function filesBelow(root: string): Promise<string[]> {
  const found: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else found.push(absolute);
    }
  }
  await visit(root);
  return found;
}

describe("signed manufacturing export import boundary", () => {
  it("validates the exact persisted attempt, GitHub OIDC claims and Sigstore inventory before storing", async () => {
    const deps = dependencies();
    const archive = await archiveFixture();
    const expectedDigest = createHash("sha256").update(archive).digest("hex");
    const response = await handleSignedManufacturingExportImport(request(archive), { runId, attemptId }, deps);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, sha256: expectedDigest, subjects: 29 });
    expect(deps.verifyOidc).toHaveBeenCalledWith("signed.github.oidc", expectedRun());
    expect(deps.verifyArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        manifestPath: "build/boardreadyops-attested/manifest.json",
        expected: expect.objectContaining({
          reviewedSha: targetSha,
          signerSha,
          runId: runNumber,
          runAttempt: 1,
          repositoryId: repoId,
        }),
      }),
    );
    expect(deps.query).toHaveBeenCalledOnce();
    expect(deps.closeQueryExecutor).toHaveBeenCalledOnce();
    const archivePath = (await filesBelow(deps.environment.ARTIFACT_STORAGE_ROOT ?? ""))[0];
    expect(archivePath).toBeDefined();
    if (!archivePath) throw new Error("stored artifact file is missing");
    expect(await fs.readFile(archivePath)).toEqual(Buffer.from(archive));
  });

  it("rejects a token from a different workflow run, attempt or signer before accepting bytes", async () => {
    for (const change of [
      { workflowRunId: "29121986403" },
      { runAttempt: 2 },
      { repositoryId: "123" },
      { workflowRef: "octo-org/hardware-board/.github/workflows/other.yml@refs/heads/main" },
    ]) {
      const deps = dependencies();
      deps.verifyOidc.mockResolvedValueOnce({ ...claims(), ...change });
      const response = await handleSignedManufacturingExportImport(
        request(await archiveFixture()),
        { runId, attemptId },
        deps,
      );
      expect(response.status).toBe(401);
      expect(deps.verifyArchive).not.toHaveBeenCalled();
      expect(deps.query).not.toHaveBeenCalled();
    }
  });

  it("rejects a signed bundle whose signer commit differs from the authenticated workflow SHA", async () => {
    const deps = dependencies();
    deps.verifyArchive.mockResolvedValueOnce({ status: "rejected", reason: "signer digest mismatch" });
    const response = await handleSignedManufacturingExportImport(
      request(await archiveFixture()),
      { runId, attemptId },
      deps,
    );
    expect(response.status).toBe(422);
    expect(deps.verifyArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: expect.objectContaining({ signerSha }),
      }),
    );
    expect(deps.query).not.toHaveBeenCalled();
  });

  it("rejects tar symlinks before extraction or cryptographic verification", async () => {
    const deps = dependencies();
    const response = await handleSignedManufacturingExportImport(
      request(await archiveFixture(true)),
      { runId, attemptId },
      deps,
    );
    expect(response.status).toBe(400);
    expect(deps.verifyArchive).not.toHaveBeenCalled();
    expect(deps.query).not.toHaveBeenCalled();
  });

  it("removes the staged archive when the database says the attempt is stale or already imported", async () => {
    for (const outcome of ["stale", "replayed"]) {
      const deps = dependencies(outcome);
      const response = await handleSignedManufacturingExportImport(
        request(await archiveFixture()),
        { runId, attemptId },
        deps,
      );
      expect(response.status).toBe(409);
      expect(await filesBelow(deps.environment.ARTIFACT_STORAGE_ROOT ?? "")).toHaveLength(0);
    }
  });

  it("rejects missing OIDC authentication and invalid route IDs before storage access", async () => {
    const deps = dependencies();
    const missingToken = new Request("https://boardreadyops.test/upload", {
      method: "POST",
      headers: { "content-type": "application/gzip" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect((await handleSignedManufacturingExportImport(missingToken, { runId, attemptId }, deps)).status).toBe(401);
    expect(
      (await handleSignedManufacturingExportImport(request(new Uint8Array([1])), { runId: "bad", attemptId }, deps))
        .status,
    ).toBe(400);
    expect(deps.loadExpectedRun).not.toHaveBeenCalled();
  });
});
