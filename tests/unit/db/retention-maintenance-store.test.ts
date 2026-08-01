import { describe, expect, it, vi } from "vitest";
import { createSqlRetentionMaintenanceStore } from "../../../packages/db/src/retention-maintenance-store.js";

const now = new Date("2026-07-31T05:00:00.000Z");

describe("retention maintenance store", () => {
  it("purges expired runner request nonces in a bounded skip-locked batch", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ affected: 12 }] });
    const store = createSqlRetentionMaintenanceStore({ query }, { now: () => now });

    await expect(store.purgeExpiredRunnerRequestNonces({ limit: 50_000 })).resolves.toBe(12);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /runner_request_nonces[\s\S]*for update skip locked[\s\S]*delete from runner_request_nonces/u,
      ),
      [now.toISOString(), 10_000],
    );
  });

  it("expires only pending artifact upload capabilities after their persisted deadline", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ affected: "4" }] });
    const store = createSqlRetentionMaintenanceStore({ query }, { now: () => now, defaultBatchSize: 50 });

    await expect(store.expireArtifactUploadCapabilities()).resolves.toBe(4);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /status = 'pending'[\s\S]*expires_at <=[\s\S]*for update skip locked[\s\S]*status = 'expired'/u,
      ),
      [now.toISOString(), 50],
    );
  });

  it("revokes only unconsumed active enrollments after expiry", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ affected: 3 }] });
    const store = createSqlRetentionMaintenanceStore({ query }, { now: () => now });

    await expect(store.revokeExpiredRunnerRegistrationEnrollments({ limit: 25 })).resolves.toBe(3);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /runner_registration_enrollments[\s\S]*consumed_at is null[\s\S]*revoked_at is null[\s\S]*set revoked_at/u,
      ),
      [now.toISOString(), 25],
    );
  });

  it("expires pending and dispatched setup probes without touching terminal probes", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ affected: 2 }] });
    const store = createSqlRetentionMaintenanceStore({ query }, { now: () => now });

    await expect(store.expireRepositorySetupProbes()).resolves.toBe(2);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /repository_setup_probes[\s\S]*status in \('pending', 'dispatched'\)[\s\S]*set status = 'expired'/u,
      ),
      [now.toISOString(), 1_000],
    );
  });

  it("purges terminal artifact capabilities only after the configured retention cutoff", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ affected: 6 }] });
    const store = createSqlRetentionMaintenanceStore({ query }, { now: () => now });

    await expect(store.purgeTerminalArtifactUploadCapabilities({ retentionDays: 30, limit: 25 })).resolves.toBe(6);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /status in \('uploaded', 'failed', 'expired', 'revoked'\)[\s\S]*coalesce\([\s\S]*uploaded_at,[\s\S]*failed_at[\s\S]*for update skip locked[\s\S]*delete from runner_artifact_upload_capabilities/u,
      ),
      ["2026-07-01T05:00:00.000Z", 25],
    );
  });

  it("purges consumed or revoked enrollments only after the configured retention cutoff", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ affected: 5 }] });
    const store = createSqlRetentionMaintenanceStore({ query }, { now: () => now });

    await expect(store.purgeTerminalRunnerRegistrationEnrollments({ retentionDays: 7 })).resolves.toBe(5);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /consumed_at is not null[\s\S]*or runner_registration_enrollments.revoked_at is not null[\s\S]*coalesce\([\s\S]*consumed_at,[\s\S]*revoked_at[\s\S]*delete from runner_registration_enrollments/u,
      ),
      ["2026-07-24T05:00:00.000Z", 1_000],
    );
  });

  it("purges completed setup probes only after the configured retention cutoff", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ affected: 4 }] });
    const store = createSqlRetentionMaintenanceStore({ query }, { now: () => now });

    await expect(store.purgeTerminalRepositorySetupProbes({ retentionDays: 1 })).resolves.toBe(4);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /status in \('completed', 'failed', 'expired'\)[\s\S]*completed_at <=[\s\S]*delete from repository_setup_probes/u,
      ),
      ["2026-07-30T05:00:00.000Z", 1_000],
    );
  });

  it("purges only old completed outbox effects that are not under active reconciliation", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ affected: 8 }] });
    const store = createSqlRetentionMaintenanceStore({ query }, { now: () => now });

    await expect(store.purgeCompletedControlPlaneOutbox({ retentionDays: 90, limit: 40 })).resolves.toBe(8);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("boardreadyops_purge_completed_control_plane_outbox"), [
      "2026-05-02T05:00:00.000Z",
      40,
    ]);
  });

  it("purges only old completed reconciliation records", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ affected: 9 }] });
    const store = createSqlRetentionMaintenanceStore({ query }, { now: () => now });

    await expect(store.purgeCompletedControlPlaneReconciliationItems({ retentionDays: 90 })).resolves.toBe(9);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /control_plane_reconciliation_items[\s\S]*status = 'completed'[\s\S]*completed_at <=[\s\S]*for update skip locked[\s\S]*delete from control_plane_reconciliation_items/u,
      ),
      ["2026-05-02T05:00:00.000Z", 1_000],
    );
  });

  it("rejects invalid terminal retention periods before querying", async () => {
    const query = vi.fn();
    const store = createSqlRetentionMaintenanceStore({ query }, { now: () => now });

    await expect(store.purgeTerminalArtifactUploadCapabilities({ retentionDays: 0 })).rejects.toThrow(
      "retentionDays must be a positive integer",
    );
    await expect(store.purgeTerminalRunnerRegistrationEnrollments({ retentionDays: 1.5 })).rejects.toThrow(
      "retentionDays must be a positive integer",
    );
    await expect(store.purgeTerminalRepositorySetupProbes({ retentionDays: 3651 })).rejects.toThrow(
      "retentionDays must be between 1 and 3650",
    );
    await expect(store.purgeCompletedControlPlaneOutbox({ retentionDays: 0 })).rejects.toThrow(
      "retentionDays must be a positive integer",
    );
    await expect(store.purgeCompletedControlPlaneReconciliationItems({ retentionDays: 3651 })).rejects.toThrow(
      "retentionDays must be between 1 and 3650",
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("uses a safe default batch and normalizes malformed result counts", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ affected: "not-a-number" }] });
    const store = createSqlRetentionMaintenanceStore({ query }, { now: () => now });

    await expect(store.purgeExpiredRunnerRequestNonces()).resolves.toBe(0);
    expect(query.mock.calls[0]?.[1]).toEqual([now.toISOString(), 1_000]);
  });

  it("rejects invalid configured batch limits before querying", () => {
    expect(() => createSqlRetentionMaintenanceStore({ query: vi.fn() }, { defaultBatchSize: 0 })).toThrow(
      "defaultBatchSize must be a positive integer",
    );
    expect(() => createSqlRetentionMaintenanceStore({ query: vi.fn() }, { defaultBatchSize: 1.5 })).toThrow(
      "defaultBatchSize must be a positive integer",
    );
  });
});
