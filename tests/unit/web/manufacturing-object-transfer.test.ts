import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  handleManufacturingObjectTransfer,
  type ManufacturingObjectTransferDependencies,
} from "../../../apps/web/lib/manufacturing-object-transfer.js";

const runId = "5dc4193b-5c7e-4df8-b86f-e4d3266fc22d";
const attemptId = "7559e99b-4998-4e02-a94a-7a7a4686ae11";
const uploadId = "9e638297-a3cb-4707-9d44-0f31d60b03ac";
const artifactId = "e2dca950-85e0-4f7e-8d48-e5599d85a3a1";
const targetSha = "a".repeat(40);
const signerSha = "b".repeat(40);
const now = new Date("2026-11-15T00:00:00.000Z");

const expected = {
  runId,
  executionAttemptId: attemptId,
  repositoryRecordId: "repo-db-123",
  installationId: "install-db-123",
  attemptNumber: 1,
  workflowPath: ".github/workflows/readiness-runner.yml",
  repository: "octo-org/hardware-board",
  repositoryId: "987654321",
  githubRunId: "29121986402",
  runAttempt: 1,
  targetSha,
  workflowRef: "octo-org/hardware-board/.github/workflows/readiness-runner.yml@refs/heads/main",
  ref: "refs/heads/main",
  audience: "unused",
  trustMode: "standard" as const,
  safeModeReasons: [] as const,
};

function tarEntry(name: string, body: Buffer, type: "0" | "5" = "0"): Buffer {
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
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  const checksum = header.reduce((sum, b) => sum + b, 0);
  put(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}

const archive = new Uint8Array(
  gzipSync(
    Buffer.concat([
      tarEntry("build/", Buffer.alloc(0), "5"),
      tarEntry("build/boardreadyops-attested/", Buffer.alloc(0), "5"),
      tarEntry("build/boardreadyops-attested/manifest.json", Buffer.from('{"fixture":true}')),
      tarEntry("bundle.sigstore.json", Buffer.from('{"signed":true}')),
      Buffer.alloc(1024),
    ]),
  ),
);
const digest = createHash("sha256").update(archive).digest("hex");

function makeDeps(): ManufacturingObjectTransferDependencies & {
  query: ReturnType<typeof vi.fn>;
  objectStore: NonNullable<ManufacturingObjectTransferDependencies["objectStore"]>;
  verifyOidc: ReturnType<typeof vi.fn>;
  id: ReturnType<typeof vi.fn>;
} {
  const objectStore = {
    signPendingUpload: vi.fn(async () => ({
      url: "https://br-f1.storage.c-2.eu-central-1.aws.neon.tech/private/pending/signed?X-Amz-Expires=120",
      headers: {
        "content-length": String(archive.length),
        "content-type": "application/gzip",
        "x-amz-checksum-sha256": Buffer.from(digest, "hex").toString("base64"),
      },
      key: `pending/${runId}/${attemptId}/${uploadId}.tar.gz`,
    })),
    promotePending: vi.fn(async () => undefined),
    getVerified: vi.fn(async () => new Response(archive, { status: 200 })),
    deletePending: vi.fn(async () => undefined),
    deleteVerified: vi.fn(async () => undefined),
  };
  const query = vi.fn(async () => ({ rows: [{ outcome: "accepted" }] }));
  const id = vi.fn().mockReturnValueOnce(uploadId).mockReturnValueOnce(artifactId);
  const verifyOidc = vi.fn(async () => ({
    workflowSha: signerSha,
    workflowRunId: expected.githubRunId,
    runAttempt: 1,
    repository: expected.repository,
    repositoryId: expected.repositoryId,
    workflowRef: expected.workflowRef,
    ref: expected.ref,
    event: "workflow_dispatch",
    runnerEnvironment: "github-hosted",
  }));
  return {
    environment: {
      BOARDREADYOPS_MANUFACTURING_OBJECT_STORAGE_ENABLED: "true",
      ARTIFACT_DOWNLOAD_SIGNING_KEY: "k".repeat(32),
    },
    queryExecutor: () => ({ query }),
    loadExpectedRun: vi.fn(async () => expected),
    verifyOidc,
    verifyArchive: vi.fn(async () => ({ status: "eligible" as const, reason: "verified", subjects: 29 })),
    now: () => now,
    id,
    objectStore,
    query,
  };
}

function request(body: Record<string, unknown>, token = "Bearer trusted.github.oidc"): Request {
  return new Request(
    `https://boardreadyops.test/api/v1/runs/${runId}/attempts/${attemptId}/manufacturing-export/object`,
    {
      method: "POST",
      headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("source-bound private-object manufacturing upload", () => {
  it("never offers an upload when the feature is off or OIDC cannot authenticate the stored run", async () => {
    const off = makeDeps();
    off.environment = { BOARDREADYOPS_MANUFACTURING_OBJECT_STORAGE_ENABLED: "false" };
    expect(
      (
        await handleManufacturingObjectTransfer(
          request({ operation: "prepare", sha256: digest, bytes: archive.length }),
          { runId, attemptId },
          off,
        )
      ).status,
    ).toBe(409);
    expect(off.objectStore.signPendingUpload).not.toHaveBeenCalled();
    const wrong = makeDeps();
    wrong.verifyOidc.mockResolvedValue(undefined);
    expect(
      (
        await handleManufacturingObjectTransfer(
          request({ operation: "prepare", sha256: digest, bytes: archive.length }),
          { runId, attemptId },
          wrong,
        )
      ).status,
    ).toBe(401);
    expect(wrong.objectStore.signPendingUpload).not.toHaveBeenCalled();
  });

  it("issues a bounded source-bound upload ticket without passing any ZIP bytes through the API", async () => {
    const deps = makeDeps();
    const response = await handleManufacturingObjectTransfer(
      request({ operation: "prepare", sha256: digest, bytes: archive.length }),
      { runId, attemptId },
      deps,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, uploadId, bytes: archive.length, sha256: digest });
    expect(body.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(deps.objectStore.signPendingUpload).toHaveBeenCalledWith({
      runId,
      attemptId,
      uploadId,
      sha256: digest,
      bytes: archive.length,
    });
    expect(deps.query).not.toHaveBeenCalled();
  });

  it("rejects invalid lengths and unsigned completion without storage or DB writes", async () => {
    const deps = makeDeps();
    for (const bad of [
      { operation: "prepare", sha256: digest, bytes: 134217729 },
      { operation: "prepare", sha256: "wrong", bytes: 15 },
      { operation: "prepare", sha256: digest, bytes: 0 },
      { operation: "commit", uploadId, sha256: digest, bytes: archive.length, expiresAt: 0, ticket: "bad" },
    ]) {
      const response = await handleManufacturingObjectTransfer(request(bad), { runId, attemptId }, deps);
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    expect(deps.objectStore.promotePending).not.toHaveBeenCalled();
    expect(deps.query).not.toHaveBeenCalled();
  });

  it("promotes and independently verifies copied bytes before recording the artifact and only then cleans pending", async () => {
    const deps = makeDeps();
    const prepared = await handleManufacturingObjectTransfer(
      request({ operation: "prepare", sha256: digest, bytes: archive.length }),
      { runId, attemptId },
      deps,
    );
    const ticket = await prepared.json();
    const done = await handleManufacturingObjectTransfer(
      request({
        operation: "commit",
        uploadId: ticket.uploadId,
        sha256: digest,
        bytes: archive.length,
        expiresAt: ticket.expiresAt,
        ticket: ticket.ticket,
      }),
      { runId, attemptId },
      deps,
    );
    expect(done.status).toBe(201);
    const payload = await done.json();
    expect(payload).toMatchObject({ ok: true, artifactId, sha256: digest, storage: "neon-s3" });
    expect(deps.objectStore.promotePending).toHaveBeenCalledWith({ runId, attemptId, uploadId, artifactId });
    expect(deps.objectStore.getVerified).toHaveBeenCalledWith(
      `neon-s3/verified/${runId}/${attemptId}/${artifactId}.tar.gz`,
    );
    expect(deps.query).toHaveBeenCalledOnce();
    expect(deps.objectStore.deletePending).toHaveBeenCalledOnce();
    expect(deps.objectStore.deleteVerified).not.toHaveBeenCalled();
  });

  it("rejects modified copied bytes and never records a false signed package", async () => {
    const deps = makeDeps();
    const prepared = await handleManufacturingObjectTransfer(
      request({ operation: "prepare", sha256: digest, bytes: archive.length }),
      { runId, attemptId },
      deps,
    );
    const ticket = await prepared.json();
    deps.objectStore.getVerified = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const response = await handleManufacturingObjectTransfer(
      request({
        operation: "commit",
        uploadId,
        sha256: digest,
        bytes: archive.length,
        expiresAt: ticket.expiresAt,
        ticket: ticket.ticket,
      }),
      { runId, attemptId },
      deps,
    );
    expect(response.status).toBe(422);
    expect(deps.query).not.toHaveBeenCalled();
    expect(deps.objectStore.deleteVerified).toHaveBeenCalledOnce();
  });
});

describe("private object upload failure and isolation boundaries", () => {
  it("refuses a mismatched source run even when another valid attempt has matching OIDC", async () => {
    const deps = makeDeps();
    deps.loadExpectedRun = vi.fn(async () => ({ ...expected, runId: "another-run-id" }));
    const result = await handleManufacturingObjectTransfer(
      request({ operation: "prepare", sha256: digest, bytes: archive.length }),
      { runId, attemptId },
      deps,
    );
    expect(result.status).toBe(409);
    expect(deps.objectStore.signPendingUpload).not.toHaveBeenCalled();
  });

  it("rejects a swapped checksum or an expired signed ticket before S3 promotion", async () => {
    const deps = makeDeps();
    const prepared = await handleManufacturingObjectTransfer(
      request({ operation: "prepare", sha256: digest, bytes: archive.length }),
      { runId, attemptId },
      deps,
    );
    const ticket = await prepared.json();
    const changed = await handleManufacturingObjectTransfer(
      request({
        operation: "commit",
        uploadId,
        sha256: "b".repeat(64),
        bytes: archive.length,
        expiresAt: ticket.expiresAt,
        ticket: ticket.ticket,
      }),
      { runId, attemptId },
      deps,
    );
    expect(changed.status).toBe(403);
    const expired = await handleManufacturingObjectTransfer(
      request({
        operation: "commit",
        uploadId,
        sha256: digest,
        bytes: archive.length,
        expiresAt: 1,
        ticket: ticket.ticket,
      }),
      { runId, attemptId },
      deps,
    );
    expect(expired.status).toBe(403);
    expect(deps.objectStore.promotePending).not.toHaveBeenCalled();
  });

  it("removes a copy that fails before verification, never recording a stored artifact", async () => {
    const deps = makeDeps();
    const prepared = await handleManufacturingObjectTransfer(
      request({ operation: "prepare", sha256: digest, bytes: archive.length }),
      { runId, attemptId },
      deps,
    );
    const ticket = await prepared.json();
    deps.objectStore.getVerified = vi.fn(async () => {
      throw new Error("private store unavailable");
    });
    const result = await handleManufacturingObjectTransfer(
      request({
        operation: "commit",
        uploadId,
        sha256: digest,
        bytes: archive.length,
        expiresAt: ticket.expiresAt,
        ticket: ticket.ticket,
      }),
      { runId, attemptId },
      deps,
    );
    expect(result.status).toBe(503);
    expect(deps.query).not.toHaveBeenCalled();
    expect(deps.objectStore.deleteVerified).toHaveBeenCalledOnce();
  });

  it("preserves verified bytes when PostgreSQL commit acknowledgement is ambiguous", async () => {
    const deps = makeDeps();
    const prepared = await handleManufacturingObjectTransfer(
      request({ operation: "prepare", sha256: digest, bytes: archive.length }),
      { runId, attemptId },
      deps,
    );
    const ticket = await prepared.json();
    deps.query.mockRejectedValueOnce(new Error("connection closed after possible commit"));
    const result = await handleManufacturingObjectTransfer(
      request({
        operation: "commit",
        uploadId,
        sha256: digest,
        bytes: archive.length,
        expiresAt: ticket.expiresAt,
        ticket: ticket.ticket,
      }),
      { runId, attemptId },
      deps,
    );
    expect(result.status).toBe(503);
    expect(deps.objectStore.deleteVerified).not.toHaveBeenCalled();
    expect(deps.objectStore.deletePending).not.toHaveBeenCalled();
  });
});
