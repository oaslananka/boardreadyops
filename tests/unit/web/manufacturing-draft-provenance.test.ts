import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyStoredManufacturingDraftClaim } from "../../../apps/web/lib/manufacturing-draft-provenance.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";
import { signManufacturingDraftReceipt } from "../../../src/runner/draft-attestation.js";

const ids = {
  runner: "11111111-1111-4111-8111-111111111111",
  run: "22222222-2222-4222-8222-222222222222",
  attempt: "33333333-3333-4333-8333-333333333333",
  lease: "44444444-4444-4444-8444-444444444444",
  archive: "55555555-5555-4555-8555-555555555555",
  receipt: "66666666-6666-4666-8666-666666666666",
};
const goodZip = Buffer.from(
  "UEsDBBQAAAAIAKRtVV0z7c5VJwAAACUAAAAWAAAAZmFicmljYXRpb24vUkVBRE1FLnR4dHMJcnQLUfD384lU0FXw8w9RcHN0CvJ0dgzx9PdTcAwICPIPc/QBAFBLAQIUAxQAAAAIAKRtVV0z7c5VJwAAACUAAAAWAAAAAAAAAAAAAACAAQAAAABmYWJyaWNhdGlvbi9SRUFETUUudHh0UEsFBgAAAAABAAEARAAAAFsAAAAAAA==",
  "base64",
);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const keys = generateKeyPairSync("ed25519");
const alternate = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const otherPublicKey = alternate.publicKey.export({ type: "spki", format: "pem" }).toString();
const roots: string[] = [];
type Row = Record<string, unknown>;
type Fixture = {
  root: string;
  rows: Row[];
  receiptBytes: Buffer;
  input: Parameters<typeof verifyStoredManufacturingDraftClaim>[0];
};

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bro-draft-server-"));
  roots.push(root);
  const payload = {
    version: 1 as const,
    purpose: "manufacturing-draft" as const,
    runnerId: ids.runner,
    runId: ids.run,
    executionAttemptId: ids.attempt,
    repository: "oaslananka/test-board",
    sourceCommitSha: "a".repeat(40),
    archiveSha256: sha(goodZip),
    archiveBytes: goodZip.length,
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(signManufacturingDraftReceipt(payload, keys.privateKey))}\n`);
  await writeFile(path.join(root, "archive.zip"), goodZip);
  await writeFile(path.join(root, "receipt.json"), receiptBytes);
  const base: Row = {
    capability_status: "uploaded",
    run_id: ids.run,
    execution_attempt_id: ids.attempt,
    lease_id: ids.lease,
    worker_class: "self_hosted",
    runner_id: ids.runner,
    registration_id: ids.runner,
    managed_identity_id: null,
    registered_key: publicKey,
    registration_allowed_repositories: [],
    registered_status: "active",
    registered_algorithm: "ed25519",
    disabled_at: null,
    lease_status: "completed",
    lease_registration_id: ids.runner,
    lease_managed_identity_id: null,
    lease_worker_class: "self_hosted",
    run_status: "completed",
    run_decision: "pass",
    run_attempt_id: ids.attempt,
    commit_sha: "a".repeat(40),
    repository_owner: "oaslananka",
    repository_name: "test-board",
    repository_private: false,
    repository_disabled_at: null,
    attempt_status: "completed",
    trust_mode: "standard",
  };
  const rows: Row[] = [
    {
      ...base,
      artifact_id: ids.archive,
      cap_kind: "archive",
      cap_role: "draft-manufacturing",
      cap_name: "draft.zip",
      cap_storage_path: "archive.zip",
      cap_content_type: "application/zip",
      cap_declared_bytes: goodZip.length,
      cap_expected_sha256: sha(goodZip),
      name: "draft.zip",
      kind: "archive",
      role: "draft-manufacturing",
      storage_path: "archive.zip",
      sha256: sha(goodZip),
      bytes: goodZip.length,
      content_type: "application/zip",
    },
    {
      ...base,
      artifact_id: ids.receipt,
      cap_kind: "attestation",
      cap_role: "draft-provenance",
      cap_name: "draft-receipt.json",
      cap_storage_path: "receipt.json",
      cap_content_type: "application/json",
      cap_declared_bytes: receiptBytes.length,
      cap_expected_sha256: sha(receiptBytes),
      name: "draft-receipt.json",
      kind: "attestation",
      role: "draft-provenance",
      storage_path: "receipt.json",
      sha256: sha(receiptBytes),
      bytes: receiptBytes.length,
      content_type: "application/json",
    },
  ];
  const executor = {
    query: async () => ({ rows }),
  } as unknown as SqlQueryExecutor;
  const input = {
    executor,
    runId: ids.run,
    executionAttemptId: ids.attempt,
    storageRoot: root,
    storageDriver: "local",
  };
  return { root, rows, receiptBytes, input };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("server-side independent runner draft claim (NOT a manufacturing authorization)", () => {
  it("verifies the registered runner, current lease, exact signed claim and real ZIP bytes", async () => {
    const f = await fixture();
    expect(await verifyStoredManufacturingDraftClaim(f.input)).toEqual({
      status: "verified-runner-claim",
      archiveArtifactId: ids.archive,
      receiptArtifactId: ids.receipt,
      archiveSha256: sha(goodZip),
    });
    // Unrelated successful report artifacts do not invalidate one unambiguous pair.
    f.rows.push({ ...f.rows[0], artifact_id: "77777777-7777-4777-8777-777777777777", kind: "report", role: "report" });
    expect((await verifyStoredManufacturingDraftClaim(f.input)).status).toBe("verified-runner-claim");
  });

  it("supports a registered managed runner without borrowing a self-hosted identity", async () => {
    const f = await fixture();
    for (const row of f.rows) {
      row.worker_class = "managed";
      row.lease_worker_class = "managed";
      row.registration_id = null;
      row.managed_identity_id = ids.runner;
      row.lease_registration_id = null;
      row.lease_managed_identity_id = ids.runner;
    }
    expect((await verifyStoredManufacturingDraftClaim(f.input)).status).toBe("verified-runner-claim");
    const row = f.rows[0];
    if (!row) throw new Error("missing fixture");
    row.lease_managed_identity_id = "88888888-8888-4888-8888-888888888888";
    expect((await verifyStoredManufacturingDraftClaim(f.input)).status).toBe("unverified");
  });

  it("honors case-insensitive scoped repository registrations", async () => {
    const f = await fixture();
    const row = f.rows[0];
    if (!row) throw new Error("missing fixture");
    row.registration_allowed_repositories = ["OASLANANKA/TEST-BOARD"];
    expect((await verifyStoredManufacturingDraftClaim(f.input)).status).toBe("verified-runner-claim");
    row.registration_allowed_repositories = ["other-tenant/test-board"];
    expect((await verifyStoredManufacturingDraftClaim(f.input)).status).toBe("unverified");
  });

  it("fails closed on missing, extra or ambiguous evidence", async () => {
    const f = await fixture();
    f.rows.splice(1, 1);
    expect((await verifyStoredManufacturingDraftClaim(f.input)).status).toBe("unverified");
    f.rows.push({ ...f.rows[0], artifact_id: ids.receipt, kind: "attestation", role: "draft-provenance" });
    expect((await verifyStoredManufacturingDraftClaim(f.input)).status).toBe("unverified");
    f.rows.push({ ...f.rows[1], artifact_id: "88888888-8888-4888-8888-888888888888" });
    expect((await verifyStoredManufacturingDraftClaim(f.input)).status).toBe("unverified");
  });

  it("refuses revoked/foreign/stale/unsafe and incorrectly linked evidence", async () => {
    const f = await fixture();
    const fieldMutations: [number, string, unknown][] = [
      [0, "registered_status", "disabled"],
      [0, "registered_algorithm", "rsa"],
      [0, "disabled_at", new Date()],
      [0, "repository_private", true],
      [0, "repository_disabled_at", new Date()],
      [0, "run_decision", "fail"],
      [0, "run_status", "superseded"],
      [0, "run_attempt_id", "99999999-9999-4999-8999-999999999999"],
      [0, "attempt_status", "superseded"],
      [0, "lease_status", "revoked"],
      [0, "capability_status", "pending"],
      [0, "trust_mode", "safe"],
      [0, "registration_id", "99999999-9999-4999-8999-999999999999"],
      [0, "lease_registration_id", null],
      [1, "runner_id", "99999999-9999-4999-8999-999999999999"],
      [1, "lease_id", "99999999-9999-4999-8999-999999999999"],
      [0, "commit_sha", "b".repeat(40)],
      [0, "repository_owner", "attacker"],
      [0, "sha256", "0".repeat(64)],
      [0, "cap_declared_bytes", goodZip.length + 1],
      [0, "cap_storage_path", "other.zip"],
      [0, "cap_role", "manufacturing"],
      [0, "registration_allowed_repositories", ["other-org/pcb"]],
      [1, "registered_key", otherPublicKey],
    ];
    for (const [row, field, value] of fieldMutations) {
      const saved = f.rows[row]?.[field];
      if (!f.rows[row]) throw new Error("test row missing");
      f.rows[row][field] = value;
      expect((await verifyStoredManufacturingDraftClaim(f.input)).status, field).toBe("unverified");
      f.rows[row][field] = saved;
    }
  });

  it("checks stored bytes, receipt signatures and safe filesystem bounds", async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, "archive.zip"), Buffer.from("PK\x03\x04 corrupted ZIP bytes"));
    expect((await verifyStoredManufacturingDraftClaim(f.input)).status).toBe("unverified");
    await writeFile(path.join(f.root, "archive.zip"), goodZip);
    const tampered = JSON.parse(f.receiptBytes.toString()) as Record<string, unknown>;
    tampered.signature = "A".repeat(86);
    const changed = Buffer.from(JSON.stringify(tampered));
    await writeFile(path.join(f.root, "receipt.json"), changed);
    const receiptRow = f.rows[1];
    if (!receiptRow) throw new Error("missing receipt fixture");
    receiptRow.sha256 = sha(changed);
    receiptRow.bytes = changed.length;
    receiptRow.cap_declared_bytes = changed.length;
    receiptRow.cap_expected_sha256 = sha(changed);
    expect((await verifyStoredManufacturingDraftClaim(f.input)).status).toBe("unverified");
    receiptRow.sha256 = sha(f.receiptBytes);
    receiptRow.bytes = f.receiptBytes.length;
    receiptRow.cap_declared_bytes = f.receiptBytes.length;
    receiptRow.cap_expected_sha256 = sha(f.receiptBytes);
    await writeFile(path.join(f.root, "receipt.json"), f.receiptBytes);
    await rm(path.join(f.root, "archive.zip"));
    const external = await mkdtemp(path.join(os.tmpdir(), "bro-draft-external-"));
    roots.push(external);
    await writeFile(path.join(external, "archive.zip"), goodZip);
    await symlink(path.join(external, "archive.zip"), path.join(f.root, "archive.zip"));
    expect((await verifyStoredManufacturingDraftClaim(f.input)).status).toBe("unverified");
  });

  it.each([
    ["runner revocation", "registered_status", "disabled"],
    ["a superseded attempt", "attempt_status", "superseded"],
    ["a replaced archive metadata row", "storage_path", "replaced.zip"],
    ["a new ambiguous ZIP", "extra_archive", "duplicate"],
  ] as const)(
    "fails closed if %s arrives after the initial SQL lookup during ZIP verification",
    async (_label, field, value) => {
      const f = await fixture();
      let queries = 0;
      const initialRows = f.rows.map((row) => ({ ...row }));
      const executor = {
        query: async () => {
          queries += 1;
          if (queries === 1) {
            // Model a committed change after the initial authoritative snapshot,
            // while the verifier is awaiting a receipt/ZIP file read.
            queueMicrotask(() => {
              if (field === "extra_archive") {
                f.rows.push({ ...f.rows[0], artifact_id: "77777777-7777-4777-8777-777777777777" });
              } else {
                const first = f.rows[0];
                if (!first) throw new Error("missing archive fixture");
                first[field] = value;
              }
            });
            return { rows: initialRows };
          }
          return { rows: f.rows.map((row) => ({ ...row })) };
        },
      } as unknown as SqlQueryExecutor;
      const result = await verifyStoredManufacturingDraftClaim({ ...f.input, executor });
      expect(result.status).toBe("unverified");
      expect(queries).toBe(2);
    },
  );

  it("rejects unsupported storage, invalid identifiers and unavailable SQL safely", async () => {
    const f = await fixture();
    for (const input of [
      { ...f.input, storageDriver: "metadata-only" },
      { ...f.input, runId: "bad" },
      { ...f.input, executionAttemptId: "bad" },
      { ...f.input, storageRoot: "" },
      {
        ...f.input,
        executor: {
          query: async () => {
            throw new Error("offline");
          },
        } as unknown as SqlQueryExecutor,
      },
    ]) {
      expect((await verifyStoredManufacturingDraftClaim(input)).status).toBe("unverified");
    }
  });
});
