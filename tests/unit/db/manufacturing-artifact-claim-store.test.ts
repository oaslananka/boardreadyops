import { describe, expect, it, vi } from "vitest";
import { createSqlRunnerArtifactStore } from "../../../packages/db/src/runner-artifact-store.js";

const now = new Date("2026-10-20T18:00:00.000Z");
const validContext = {
  workerClass: "managed" as const,
  managedRunnerIdentityId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  executionAttemptId: "33333333-3333-4333-8333-333333333333",
  leaseId: "44444444-4444-4444-8444-444444444444",
  leaseToken: "L".repeat(43),
  requestTimestamp: Math.floor(now.getTime() / 1000),
  requestNonce: "N".repeat(32),
};

describe("runner artifact storage trusts no self-declared fabrication approval", () => {
  it("denies claimed manufacturing ZIPs before issuing SQL capabilities, even without wire validation", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const store = createSqlRunnerArtifactStore({ query }, { now: () => now });
    const artifact = { kind: "archive", role: "manufacturing", name: "gerbers.zip", bytes: 100 };
    expect(await store.issueCapabilities({ ...validContext, artifacts: [artifact] })).toEqual({ status: "stale" });
    expect(query).not.toHaveBeenCalled();
  });

  it("keeps draft manufacturing archives and ordinary BOM roles eligible for capability validation", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const store = createSqlRunnerArtifactStore({ query }, { now: () => now });
    expect(
      await store.issueCapabilities({
        ...validContext,
        artifacts: [{ kind: "archive", role: "draft-manufacturing", name: "gerbers.zip", bytes: 100 }],
      }),
    ).toEqual({ status: "stale" });
    expect(query).toHaveBeenCalled(); // Reached SQL lease validation instead of the role guard.
    query.mockClear();
    expect(
      await store.issueCapabilities({
        ...validContext,
        artifacts: [{ kind: "bom", role: "manufacturing", name: "bom.csv", bytes: 100 }],
      }),
    ).toEqual({ status: "stale" });
    expect(query).toHaveBeenCalled();
  });
});
