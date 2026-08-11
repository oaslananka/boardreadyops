import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";
import { createSqlRunnerFleetHealthStore } from "../../../packages/db/src/runner-fleet-health-store.js";

const installationId = "11111111-1111-4111-8111-111111111111";
const observedAt = new Date("2026-08-02T09:30:00.000Z");

function executor(rows: Record<string, unknown>[]) {
  return { query: vi.fn(async () => ({ rows })) } as unknown as SqlQueryExecutor;
}

describe("runner fleet health store", () => {
  it("returns a tenant-scoped aggregate snapshot without customer source or runner identity fields", async () => {
    const queryExecutor = executor([
      {
        active_registrations: 3,
        online_registrations: 2,
        version_unreported_registrations: 1,
        last_seen_at: "2026-08-02T09:29:55.000Z",
        pending_jobs: 4,
        oldest_queued_at: "2026-08-02T09:20:00.000Z",
        active_leases: 2,
        earliest_lease_expiry_at: "2026-08-02T09:31:30.000Z",
        version_counts: [
          { version: "2.0.0", registrations: 1 },
          { version: "10.0.0", registrations: 1 },
        ],
      },
    ]);
    const store = createSqlRunnerFleetHealthStore(queryExecutor);

    await expect(store.readFleetHealth({ installationId, observedAt, observationWindowSeconds: 300 })).resolves.toEqual(
      {
        observedAt: observedAt.toISOString(),
        observationWindowSeconds: 300,
        status: "degraded",
        registrations: {
          active: 3,
          online: 2,
          stale: 1,
          versionUnreported: 1,
          lastSeenAt: "2026-08-02T09:29:55.000Z",
        },
        queue: { pendingJobs: 4, oldestAgeSeconds: 600 },
        leases: { active: 2, earliestExpirySeconds: 90 },
        versions: [
          { version: "10.0.0", registrations: 1 },
          { version: "2.0.0", registrations: 1 },
        ],
      },
    );

    const [sql, parameters] = vi.mocked(queryExecutor.query).mock.calls[0] ?? [];
    expect(sql).toContain("target_installation");
    expect(sql).toContain("repositories.installation_id = target_installation.id");
    expect(sql).toContain("runner_job_leases.worker_class = 'self_hosted'");
    expect(sql).toContain("boardreadyops_effective_runner_policy");
    expect(sql).not.toContain("repositories.owner");
    expect(sql).not.toContain("repositories.name");
    expect(sql).not.toContain("public_key");
    expect(parameters).toEqual([installationId, observedAt.toISOString(), 300]);
  });

  it("distinguishes not-configured, offline, healthy, and missing installations", async () => {
    const base = {
      last_seen_at: null,
      pending_jobs: 0,
      oldest_queued_at: null,
      active_leases: 0,
      earliest_lease_expiry_at: null,
      version_counts: [],
    };
    for (const [active, online, status] of [
      [0, 0, "not_configured"],
      [2, 0, "offline"],
      [2, 2, "healthy"],
    ] as const) {
      const store = createSqlRunnerFleetHealthStore(
        executor([
          {
            ...base,
            last_seen_at: active === 0 ? null : observedAt,
            active_registrations: active,
            online_registrations: online,
            version_unreported_registrations: active,
          },
        ]),
      );
      await expect(
        store.readFleetHealth({ installationId, observedAt, observationWindowSeconds: 300 }),
      ).resolves.toMatchObject({ status });
    }

    const missing = createSqlRunnerFleetHealthStore(executor([]));
    await expect(
      missing.readFleetHealth({ installationId, observedAt, observationWindowSeconds: 300 }),
    ).resolves.toBeUndefined();
  });

  it("keeps version ordering non-mutating", () => {
    const source = readFileSync("packages/db/src/runner-fleet-health-store.ts", "utf8");
    expect(source).toContain("versions.toSorted(compareVersionsDescending)");
    expect(source).not.toContain("versions.sort(compareVersionsDescending)");
  });

  it("rejects invalid input and malformed aggregate rows before exposing a snapshot", async () => {
    const queryExecutor = executor([]);
    const store = createSqlRunnerFleetHealthStore(queryExecutor);
    await expect(
      store.readFleetHealth({ installationId: "bad installation", observedAt, observationWindowSeconds: 300 }),
    ).rejects.toThrow("installationId is invalid");
    await expect(
      store.readFleetHealth({ installationId, observedAt: new Date("invalid"), observationWindowSeconds: 300 }),
    ).rejects.toThrow("observedAt is invalid");
    await expect(store.readFleetHealth({ installationId, observedAt, observationWindowSeconds: 0 })).rejects.toThrow(
      "observationWindowSeconds is invalid",
    );
    expect(queryExecutor.query).not.toHaveBeenCalled();

    const malformed = createSqlRunnerFleetHealthStore(
      executor([{ active_registrations: 1, online_registrations: 2, version_counts: [] }]),
    );
    await expect(
      malformed.readFleetHealth({ installationId, observedAt, observationWindowSeconds: 300 }),
    ).rejects.toThrow("runner fleet health row is invalid");

    const unsafeVersion = createSqlRunnerFleetHealthStore(
      executor([
        {
          active_registrations: 1,
          online_registrations: 1,
          version_unreported_registrations: 0,
          last_seen_at: observedAt,
          pending_jobs: 0,
          oldest_queued_at: null,
          active_leases: 0,
          earliest_lease_expiry_at: null,
          version_counts: [{ version: "9007199254740992.0.0", registrations: 1 }],
        },
      ]),
    );
    await expect(
      unsafeVersion.readFleetHealth({ installationId, observedAt, observationWindowSeconds: 300 }),
    ).rejects.toThrow("runner fleet health row is invalid");
  });
});
