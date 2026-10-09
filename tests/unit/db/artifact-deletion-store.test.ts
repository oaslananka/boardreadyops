import { describe, expect, it, vi } from "vitest";
import { createSqlArtifactDeletionStore } from "../../../packages/db/src/artifact-deletion-store.js";

const now = new Date("2026-07-29T19:30:00.000Z");

function executor(query = vi.fn()) {
  return { query };
}

describe("artifact deletion store", () => {
  it("fails closed when an active hold appears after a lease is claimed", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ outcome: "held" }] });
    const store = createSqlArtifactDeletionStore(executor(query), { now: () => now });
    await expect(store.authorizeOrDeferDeletion({ deletionJobId: "job-1", workerId: "worker-1" })).resolves.toBe(
      "held",
    );
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("from legal_holds");
    expect(sql).toContain("legal_holds.tenant_id = claimed.account_login");
    expect(sql).toContain("for update of artifact_deletion_jobs");
    expect(sql).toContain("artifact_deletion_jobs.lease_expires_at > $3::timestamptz");
    expect(sql).toContain("attempt_count = greatest(0, attempt_count - 1)");
    expect(query.mock.calls[0]?.[1]).toEqual(["job-1", "worker-1", now.toISOString()]);
  });

  it("rejects stale workers and allows only the current held-free lease", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ outcome: "stale" }] })
      .mockResolvedValueOnce({ rows: [{ outcome: "authorized" }] });
    const store = createSqlArtifactDeletionStore(executor(query), { now: () => now });
    await expect(store.authorizeOrDeferDeletion({ deletionJobId: "job-1", workerId: "worker-1" })).resolves.toBe(
      "stale",
    );
    await expect(store.authorizeOrDeferDeletion({ deletionJobId: "job-1", workerId: "worker-1" })).resolves.toBe(
      "authorized",
    );
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
