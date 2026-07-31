import { describe, expect, it, vi } from "vitest";
import { createSqlRunnerLeaseStore } from "../../../packages/db/src/runner-lease-store.js";

const now = new Date("2026-07-31T06:30:00.000Z");
const managedRunnerIdentityId = "e81ec5a4-c6d0-4d87-a520-f7ab922ba183";
const attemptId = "b31b614e-b656-491e-a6fa-59e13846bb0a";
const leaseId = "11e46ec0-2048-49c7-99e1-f77965218f0b";
const runId = "5422e4e1-778f-4819-8314-fae19d8b9991";
const leaseToken = "jX6JYV8a2sYeH9N7wM4QkT0iC3rF5uL1pD8bG6zA9xE";
const requestNonce = "Q3fM0nP8wK6sR2vD9yL4bT7hX1cJ5aG0eN8uZ6iS2oA";

function claimRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    outcome: "claimed",
    lease_id: leaseId,
    run_id: runId,
    execution_attempt_id: attemptId,
    expires_at: "2026-07-31T06:32:00.000Z",
    maximum_expires_at: "2026-07-31T07:00:00.000Z",
    repository_owner: "octo-org",
    repository_name: "hardware-board",
    commit_sha: "a".repeat(40),
    repository_private: false,
    trust_mode: "safe",
    safe_mode_reasons: ["private-repository"],
    ...overrides,
  };
}

function storeFor(row: Record<string, unknown>) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ expired_count: 0 }] })
    .mockResolvedValueOnce({ rows: [row] });
  return {
    query,
    store: createSqlRunnerLeaseStore(
      { query },
      {
        now: () => now,
        id: vi.fn().mockReturnValueOnce(attemptId).mockReturnValueOnce(leaseId),
        leaseToken: () => leaseToken,
      },
    ),
  };
}

const input = {
  workerClass: "managed" as const,
  managedRunnerIdentityId,
  requestTimestamp: Math.floor(now.valueOf() / 1000),
  requestNonce,
  capabilities: ["kicad:10"],
};

describe("runner lease trust snapshot", () => {
  it("uses persisted trust mode instead of mutable repository visibility", async () => {
    const { query, store } = storeFor(claimRow());

    await expect(store.claimJob(input)).resolves.toMatchObject({
      status: "claimed",
      repository: { private: false },
      safeMode: { enabled: true, reasons: ["private-repository"] },
    });
    expect(String(query.mock.calls[2]?.[0])).toContain("boardreadyops_claim_runner_job");
  });

  it("preserves the canonical persisted safe-mode reason set", async () => {
    const { store } = storeFor(
      claimRow({
        safe_mode_reasons: ["draft-pull-request", "fork-pull-request", "private-repository"],
      }),
    );

    await expect(store.claimJob(input)).resolves.toMatchObject({
      status: "claimed",
      safeMode: {
        enabled: true,
        reasons: ["draft-pull-request", "fork-pull-request", "private-repository"],
      },
    });
  });

  it("rejects an inconsistent trust snapshot returned by the database", async () => {
    const { store } = storeFor(claimRow({ trust_mode: "standard", safe_mode_reasons: ["private-repository"] }));

    await expect(store.claimJob(input)).rejects.toThrow("runner claim did not return a valid trust snapshot");
  });
});
