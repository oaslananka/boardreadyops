import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleSignedManufacturingExportImport,
  type SignedExportImportDependencies,
  tarEntryExpandedBytes,
  tarListingLines,
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

function tarEntry(name: string, body: Buffer, type: "0" | "2" | "5" = "0", linkName = ""): Buffer {
  const header = Buffer.alloc(512);
  const put = (value: string, offset: number, length: number) => header.write(value, offset, length, "utf8");
  const octal = (value: number, length: number) => `${value.toString(8).padStart(length - 1, "0")}\0`;
  put(name, 0, 100);
  put(octal(type === "5" ? 0o755 : 0o644, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(body.length, 12), 124, 12);
  put(octal(1_700_000_000, 12), 136, 12);
  header.fill(0x20, 148, 156);
  put(type, 156, 1);
  put(linkName, 157, 100);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  put("boardreadyops", 265, 32);
  put("boardreadyops", 297, 32);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  put(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  const paddedBody =
    body.length === 0 ? Buffer.alloc(0) : Buffer.concat([body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
  return Buffer.concat([header, paddedBody]);
}

async function archiveFixture(symlink = false): Promise<Uint8Array> {
  const entries = [
    tarEntry("build/", Buffer.alloc(0), "5"),
    tarEntry("build/boardreadyops-attested/", Buffer.alloc(0), "5"),
    tarEntry("build/boardreadyops-attested/manifest.json", Buffer.from(JSON.stringify({ fixture: true }))),
    tarEntry("bundle.sigstore.json", Buffer.from(JSON.stringify({ signed: true }))),
  ];
  if (symlink) {
    entries.push(tarEntry("build/boardreadyops-attested/linked.json", Buffer.alloc(0), "2", "../bundle.sigstore.json"));
  }
  const tar = Buffer.concat([...entries, Buffer.alloc(1024)]);
  return new Uint8Array(gzipSync(tar));
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

describe("portable tar metadata parsing", () => {
  it("accepts CRLF listing terminators but preserves embedded unsafe carriage returns", () => {
    expect(tarListingLines("build/\r\nbuild/boardreadyops-attested/manifest.json\r\nbundle.sigstore.json\r\n")).toEqual(
      ["build/", "build/boardreadyops-attested/manifest.json", "bundle.sigstore.json"],
    );
    expect(tarListingLines("build/unsafe\rname\n")).toEqual(["build/unsafe\rname"]);
    expect(tarListingLines("build/unsafe\r\r\n")).toEqual(["build/unsafe\r"]);
  });

  it("reads expanded sizes from GNU tar and BSD tar verbose listings", () => {
    expect(tarEntryExpandedBytes("-rw-r--r-- 0/0 19 2026-11-03 00:00 build/manifest.json")).toBe(19);
    expect(
      tarEntryExpandedBytes("-rw-r--r--  0 boardreadyops boardreadyops  29 Nov  3 00:00 build/manifest.json"),
    ).toBe(29);
    expect(tarEntryExpandedBytes("drwxr-xr-x  0 boardreadyops boardreadyops   0 Nov  3 00:00 build/")).toBe(0);
    expect(tarEntryExpandedBytes("lrwxrwxrwx 0/0 12 2026-11-03 00:00 unsafe-link")).toBeUndefined();
    expect(tarEntryExpandedBytes("not a tar verbose entry")).toBeUndefined();
  });
});

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

  it("retains complete archive bytes when the metadata commit acknowledgement is ambiguous", async () => {
    for (const caseName of ["before-write", "committed-ack-lost"] as const) {
      const deps = dependencies();
      const archive = await archiveFixture();
      const sha256 = createHash("sha256").update(archive).digest("hex");
      const recorded = new Map<string, string>();
      deps.query.mockImplementationOnce(async (...args: unknown[]) => {
        const parameters = args[1] as unknown[];
        if (caseName === "committed-ack-lost") {
          // Model the database accepting the write before its transport reply disappears.
          recorded.set(String(parameters[4]), String(parameters[5]));
        }
        throw new Error("database acknowledgement unavailable");
      });

      const response = await handleSignedManufacturingExportImport(request(archive), { runId, attemptId }, deps);
      expect(response.status).toBe(503);
      expect(deps.query).toHaveBeenCalledOnce();
      expect(deps.verifyArchive).toHaveBeenCalledOnce();
      expect(deps.closeQueryExecutor).toHaveBeenCalledOnce();

      const root = deps.environment.ARTIFACT_STORAGE_ROOT ?? "";
      const storedFiles = await filesBelow(root);
      expect(storedFiles).toHaveLength(1);
      const storedFile = storedFiles[0];
      if (!storedFile) throw new Error("ambiguous write must retain its physical archive");
      const storedBytes = await fs.readFile(storedFile);
      expect(storedBytes).toEqual(Buffer.from(archive));
      expect(createHash("sha256").update(storedBytes).digest("hex")).toBe(sha256);

      const archiveName = path.relative(root, storedFile).split(path.sep).join("/");
      if (caseName === "committed-ack-lost") {
        expect(recorded.get(archiveName)).toBe(sha256);
      } else {
        expect(recorded.size).toBe(0);
      }
      // A failed response cannot distinguish these states; neither is safe to unlink.
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

describe("opt-in temporary GitHub Actions manufacturing archives", () => {
  it("records independently verified signed metadata without retaining the submitted archive", async () => {
    const deps = dependencies();
    deps.environment = { MANUFACTURING_ARCHIVE_STORAGE: "github-actions" };
    const verify = vi.fn(async () => true);
    deps.verifyTemporaryArtifact = verify;
    const uploaded = request(await archiveFixture());
    uploaded.headers.set("x-boardreadyops-github-artifact-id", "54321");
    const result = await handleSignedManufacturingExportImport(uploaded, { runId, attemptId }, deps);
    expect(result.status).toBe(201);
    expect(await result.json()).toMatchObject({ ok: true, storage: "github-actions", subjects: 29 });
    expect(verify).toHaveBeenCalledWith(expect.anything(), expectedRun(), "54321");
    expect(deps.verifyArchive).toHaveBeenCalledOnce();
    expect(deps.query).toHaveBeenCalledOnce();
    const values = deps.query.mock.calls[0]?.[1] as unknown[];
    expect(values?.[4]).toBe("github-actions/29121986402/54321");
    // The request uses a disposable extraction directory; no final disk root exists.
    expect(await filesBelow(roots.at(-1) ?? "")).toHaveLength(0);
  });

  it("refuses mismatched client-side temporary upload versus server local storage mode", async () => {
    const deps = dependencies();
    const uploaded = request(await archiveFixture());
    uploaded.headers.set("x-boardreadyops-github-artifact-id", "54321");
    const response = await handleSignedManufacturingExportImport(uploaded, { runId, attemptId }, deps);
    expect(response.status).toBe(409);
    expect(deps.query).not.toHaveBeenCalled();
    expect(deps.verifyArchive).not.toHaveBeenCalled();
    expect(await filesBelow(roots.at(-1) ?? "")).toHaveLength(0);
  });

  it("denies a missing, unbound or replayed temporary artifact", async () => {
    const archive = await archiveFixture();
    for (const artifactId of ["", "zero", "54321"]) {
      const deps = dependencies();
      deps.environment = { MANUFACTURING_ARCHIVE_STORAGE: "github-actions" };
      deps.verifyTemporaryArtifact = vi.fn(async () => false);
      const uploaded = request(archive);
      if (artifactId) uploaded.headers.set("x-boardreadyops-github-artifact-id", artifactId);
      const response = await handleSignedManufacturingExportImport(uploaded, { runId, attemptId }, deps);
      expect(response.status).toBe(artifactId === "54321" ? 422 : 400);
      expect(deps.query).not.toHaveBeenCalled();
    }
    const deps = dependencies("replayed");
    deps.environment = { MANUFACTURING_ARCHIVE_STORAGE: "github-actions" };
    deps.verifyTemporaryArtifact = vi.fn(async () => true);
    const uploaded = request(archive);
    uploaded.headers.set("x-boardreadyops-github-artifact-id", "54321");
    const response = await handleSignedManufacturingExportImport(uploaded, { runId, attemptId }, deps);
    expect(response.status).toBe(409);
    expect(await filesBelow(roots.at(-1) ?? "")).toHaveLength(0);
  });
});
