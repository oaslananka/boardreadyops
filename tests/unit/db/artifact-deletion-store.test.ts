import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createSqlArtifactDeletionStore } from "../../../packages/db/src/artifact-deletion-store.js";

const now = new Date("2026-07-29T19:30:00.000Z");

function executor(query = vi.fn()) {
  return { query };
}

describe("artifact deletion store", () => {
  it("defers a currently leased deletion on a new tenant legal hold without exhausting retry attempts", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ outcome: "held" }] });
    const deletionStore = createSqlArtifactDeletionStore(executor(query), { now: () => now });
    await expect(
      deletionStore.beginPhysicalDeletion({
        deletionJobId: "job-1",
        workerId: "worker-1",
        fenceToken: randomUUID(),
      }),
    ).resolves.toBe("held");
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("boardreadyops_begin_artifact_unlink($1, $2, $3::uuid)");
    const migration = readFileSync(
      new URL("../../../packages/db/migrations/0097_durable_artifact_unlink_fences.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain("lower(tenant_id) = v_tenant and active = true");
    expect(migration).toContain("j.lease_expires_at > clock_timestamp()");
    expect(migration).toContain("attempt_count = greatest(0, attempt_count - 1)");
    expect(migration).toContain("available_at = clock_timestamp() + interval '30 minutes'");
    expect(migration).toContain("boardreadyops_guard_legal_hold_admission");
    expect(migration).toContain("boardreadyops_guard_installation_while_unlinking");
    expect(migration).toContain("and fence.settled_at is null");
    expect(query.mock.calls[0]?.[1]).toEqual(["job-1", "worker-1", expect.any(String)]);
  });

  it("anchors destructive lease authorization and hold deferral to the PostgreSQL clock", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ outcome: "stale" }] });
    const skewedClock = new Date("2001-01-01T00:00:00.000Z");
    const store = createSqlArtifactDeletionStore(executor(query), { now: () => skewedClock });
    await expect(
      store.beginPhysicalDeletion({
        deletionJobId: "job-with-expired-lease",
        workerId: "worker-clock-behind",
        fenceToken: randomUUID(),
      }),
    ).resolves.toBe("stale");
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("boardreadyops_begin_artifact_unlink");
    expect(sql).not.toContain("$3::timestamptz");
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      "job-with-expired-lease",
      "worker-clock-behind",
      expect.any(String),
    ]);
  });

  it("rejects stale leases and invalid worker identities without claiming authorization", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ outcome: "stale" }] })
      .mockResolvedValueOnce({ rows: [{ outcome: "authorized" }] });
    const deletionStore = createSqlArtifactDeletionStore(executor(query), { now: () => now });
    await expect(
      deletionStore.beginPhysicalDeletion({
        deletionJobId: "job-1",
        workerId: "worker-1",
        fenceToken: randomUUID(),
      }),
    ).resolves.toBe("stale");
    await expect(
      deletionStore.beginPhysicalDeletion({
        deletionJobId: "job-1",
        workerId: "worker-1",
        fenceToken: randomUUID(),
      }),
    ).resolves.toBe("authorized");
    await expect(
      deletionStore.beginPhysicalDeletion({
        deletionJobId: "job-1",
        workerId: "bad worker",
        fenceToken: randomUUID(),
      }),
    ).rejects.toThrow("invalid artifact deletion worker id");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("settles only by matching job, worker, and attempt token", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ outcome: "settled" }] });
    const store = createSqlArtifactDeletionStore(executor(query));
    const fenceToken = randomUUID();
    await expect(
      store.settlePhysicalDeletion({
        deletionJobId: "job-1",
        workerId: "worker-1",
        fenceToken,
        outcome: "missing",
      }),
    ).resolves.toBe("settled");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("boardreadyops_settle_artifact_unlink"), [
      "job-1",
      "worker-1",
      fenceToken,
      "missing",
    ]);
  });

  it("claims bounded tenant-scoped deletion jobs", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          deletion_job_id: "job-1",
          artifact_id: "artifact-1",
          installation_id: "installation-1",
          repository_id: "repository-1",
          release_run_id: "run-1",
          storage_driver: "local",
          storage_path: "run-1/artifact-1.bin",
          deletion_reason: "result_replaced",
          attempt_count: 1,
        },
      ],
    });
    const store = createSqlArtifactDeletionStore(executor(query), { now: () => now, leaseSeconds: 60 });

    await expect(store.claimDeletions({ workerId: "worker-1", limit: 200 })).resolves.toEqual([
      {
        deletionJobId: "job-1",
        artifactId: "artifact-1",
        installationId: "installation-1",
        repositoryId: "repository-1",
        releaseRunId: "run-1",
        storageDriver: "local",
        storagePath: "run-1/artifact-1.bin",
        deletionReason: "result_replaced",
        attemptCount: 1,
      },
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("boardreadyops_claim_artifact_deletions"), [
      "worker-1",
      now.toISOString(),
      "2026-07-29T19:31:00.000Z",
      100,
    ]);
  });

  it("completes deletion with a persisted idempotent outcome", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ outcome: "completed" }] });
    const store = createSqlArtifactDeletionStore(executor(query), { now: () => now });

    await expect(
      store.completeDeletion({ deletionJobId: "job-1", workerId: "worker-1", outcome: "missing" }),
    ).resolves.toBe("completed");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("boardreadyops_complete_artifact_deletion"), [
      "job-1",
      "worker-1",
      now.toISOString(),
      "missing",
    ]);
  });

  it("backs off retryable failures without persisting credential-shaped text", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ outcome: "retry" }] });
    const store = createSqlArtifactDeletionStore(executor(query), { now: () => now, retryBaseSeconds: 10 });

    await expect(
      store.failDeletion({
        deletionJobId: "job-1",
        workerId: "worker-1",
        attemptCount: 2,
        retryable: true,
        errorClass: "EIO",
        errorMessage: "token=example-value filesystem error",
      }),
    ).resolves.toBe("retry");
    const params = query.mock.calls[0]?.[1] as unknown[];
    expect(params.slice(0, 5)).toEqual(["job-1", "worker-1", now.toISOString(), "2026-07-29T19:30:20.000Z", true]);
    expect(params[6]).toBe("[redacted credential] filesystem error");
  });

  it("collects content-free deletion queue metrics", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ available: 2, leased: 1, dead_letter: 3, oldest_age: 45 }],
    });
    const store = createSqlArtifactDeletionStore(executor(query));

    await expect(store.collectMetrics()).resolves.toEqual({
      availableArtifactDeletions: 2,
      leasedArtifactDeletions: 1,
      deadLetterArtifactDeletions: 3,
      oldestAvailableArtifactDeletionAgeSeconds: 45,
    });
  });
  it("accepts string attempt counts and default claim bounds", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          deletion_job_id: "job-2",
          artifact_id: "artifact-2",
          installation_id: "installation-1",
          repository_id: "repository-1",
          release_run_id: "run-1",
          storage_driver: "local",
          storage_path: "run-1/artifact-2.bin",
          deletion_reason: "result_replaced",
          attempt_count: "2",
        },
      ],
    });
    const store = createSqlArtifactDeletionStore(executor(query), { now: () => now });

    await expect(store.claimDeletions({ workerId: "worker-2" })).resolves.toEqual([
      expect.objectContaining({ deletionJobId: "job-2", attemptCount: 2 }),
    ]);
    expect(query.mock.calls[0]?.[1]).toEqual(["worker-2", now.toISOString(), "2026-07-29T19:32:00.000Z", 1]);
  });

  it("rejects invalid workers, options, and incomplete claims", async () => {
    const query = vi.fn();
    const store = createSqlArtifactDeletionStore(executor(query), { now: () => now });

    await expect(store.claimDeletions({ workerId: " invalid worker " })).rejects.toThrow(
      "invalid artifact deletion worker id",
    );
    expect(query).not.toHaveBeenCalled();

    expect(() => createSqlArtifactDeletionStore(executor(), { leaseSeconds: 0 })).toThrow(
      "leaseSeconds must be a positive integer",
    );
    expect(() => createSqlArtifactDeletionStore(executor(), { retryBaseSeconds: 1.5 })).toThrow(
      "retryBaseSeconds must be a positive integer",
    );

    const incomplete = createSqlArtifactDeletionStore(
      executor(vi.fn().mockResolvedValue({ rows: [{ deletion_job_id: "job-incomplete" }] })),
      { now: () => now },
    );
    await expect(incomplete.claimDeletions({ workerId: "worker-1" })).rejects.toThrow(
      "artifact deletion claim returned an incomplete job",
    );
  });

  it("returns stale for absent completion and failure outcomes", async () => {
    const completeStore = createSqlArtifactDeletionStore(executor(vi.fn().mockResolvedValue(null)), { now: () => now });
    await expect(
      completeStore.completeDeletion({ deletionJobId: "job-1", workerId: "worker-1", outcome: "deleted" }),
    ).resolves.toBe("stale");

    const failStore = createSqlArtifactDeletionStore(executor(vi.fn().mockResolvedValue({ rows: {} })), {
      now: () => now,
    });
    await expect(
      failStore.failDeletion({
        deletionJobId: "job-1",
        workerId: "worker-1",
        attemptCount: 1,
        retryable: false,
        errorClass: "EACCES",
        errorMessage: "denied",
      }),
    ).resolves.toBe("stale");
  });

  it("preserves terminal failure outcomes and safe fallback text", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ outcome: "dead_letter" }] });
    const store = createSqlArtifactDeletionStore(executor(query), { now: () => now, retryBaseSeconds: 15 });

    await expect(
      store.failDeletion({
        deletionJobId: "job-1",
        workerId: "worker-1",
        attemptCount: 99,
        retryable: false,
        errorClass: " \n\t ",
        errorMessage: " \r\n ",
      }),
    ).resolves.toBe("dead_letter");
    const params = query.mock.calls[0]?.[1] as unknown[];
    expect(params[3]).toBe("2026-07-29T20:30:00.000Z");
    expect(params[5]).toBe("unclassified");
    expect(params[6]).toBe("Artifact object deletion failed.");
  });

  it("parses string metrics and defaults malformed values to zero", async () => {
    const stringQuery = vi.fn().mockResolvedValue({
      rows: [{ available: "2", leased: "1", dead_letter: "3", oldest_age: "45" }],
    });
    const stringStore = createSqlArtifactDeletionStore(executor(stringQuery));
    await expect(stringStore.collectMetrics()).resolves.toEqual({
      availableArtifactDeletions: 2,
      leasedArtifactDeletions: 1,
      deadLetterArtifactDeletions: 3,
      oldestAvailableArtifactDeletionAgeSeconds: 45,
    });

    const malformedStore = createSqlArtifactDeletionStore(
      executor(
        vi.fn().mockResolvedValue({
          rows: [{ available: -1, leased: 1.5, dead_letter: "not-a-number", oldest_age: "999999999999999999999" }],
        }),
      ),
    );
    await expect(malformedStore.collectMetrics()).resolves.toEqual({
      availableArtifactDeletions: 0,
      leasedArtifactDeletions: 0,
      deadLetterArtifactDeletions: 0,
      oldestAvailableArtifactDeletionAgeSeconds: 0,
    });
  });
});
