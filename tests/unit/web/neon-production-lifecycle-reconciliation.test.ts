import { describe, expect, it, vi } from "vitest";
import {
  createProductionNeonLifecycleReconciliationOperation,
  runClaimedLifecycleReconciliationPass,
} from "../../../apps/web/lib/neon-production-lifecycle-reconciliation.js";
import type { ClaimedControlPlaneReconciliationItem } from "../../../packages/db/src/control-plane-operations-store.js";

const item = (id: string) => ({ reconciliationId: id, attemptCount: 1 }) as ClaimedControlPlaneReconciliationItem;

const options = () => ({
  workerId: "neon-lifecycle-test",
  limit: 2,
  signal: new AbortController().signal,
  operations: {
    detectLifecycleReconciliationCandidates: vi.fn(async () => 2),
    claimLifecycleReconciliationItems: vi.fn(async () => [item("one"), item("two")]),
    applyLifecycleReconciliation: vi.fn(async () => "applied" as const),
    failReconciliationItem: vi.fn(async () => "retry" as const),
  },
});

describe("Neon lifecycle reconciliation of persisted GitHub App states", () => {
  it("detects bounded candidates and applies existing persisted reconciliation transitions", async () => {
    const input = options();
    await runClaimedLifecycleReconciliationPass(input);
    expect(input.operations.detectLifecycleReconciliationCandidates).toHaveBeenCalledWith({
      observationDelaySeconds: 300,
      terminalDeadlineSeconds: 1800,
      limit: 10,
    });
    expect(input.operations.claimLifecycleReconciliationItems).toHaveBeenCalledWith({
      workerId: input.workerId,
      limit: 2,
    });
    expect(input.operations.applyLifecycleReconciliation).toHaveBeenCalledTimes(2);
    expect(input.operations.applyLifecycleReconciliation).toHaveBeenNthCalledWith(1, {
      reconciliationId: "one",
      workerId: input.workerId,
    });
    expect(input.operations.failReconciliationItem).not.toHaveBeenCalled();
  });

  it("does not touch the database if exclusive ownership has already been lost", async () => {
    const input = options();
    const abort = new AbortController();
    abort.abort();
    await expect(runClaimedLifecycleReconciliationPass({ ...input, signal: abort.signal })).rejects.toThrow(
      "worker_ownership_lost",
    );
    expect(input.operations.detectLifecycleReconciliationCandidates).not.toHaveBeenCalled();
    expect(input.operations.claimLifecycleReconciliationItems).not.toHaveBeenCalled();
  });

  it("stops before processing the second claimed item on ownership loss", async () => {
    const input = options();
    const abort = new AbortController();
    input.operations.applyLifecycleReconciliation.mockImplementation(async () => {
      abort.abort();
      return "applied" as const;
    });
    await expect(runClaimedLifecycleReconciliationPass({ ...input, signal: abort.signal })).rejects.toThrow(
      "worker_ownership_lost",
    );
    expect(input.operations.applyLifecycleReconciliation).toHaveBeenCalledTimes(1);
  });

  it("does not report a database detection error as a successful empty pass", async () => {
    const input = options();
    input.operations.detectLifecycleReconciliationCandidates.mockRejectedValue(new Error("database_unavailable"));
    await expect(runClaimedLifecycleReconciliationPass(input)).rejects.toThrow("database_unavailable");
    expect(input.operations.claimLifecycleReconciliationItems).not.toHaveBeenCalled();
  });

  it("uses the canonical retry transition instead of silently dropping failed work", async () => {
    const input = options();
    input.operations.applyLifecycleReconciliation.mockRejectedValue(new Error("db_failure"));
    await runClaimedLifecycleReconciliationPass(input);
    expect(input.operations.failReconciliationItem).toHaveBeenCalledTimes(2);
    expect(input.operations.failReconciliationItem).toHaveBeenNthCalledWith(1, {
      reconciliationId: "one",
      workerId: input.workerId,
      attemptCount: 1,
      errorClass: "Error",
      errorMessage: "Control-plane lifecycle reconciliation failed.",
    });
  });

  it("rejects unbounded or unauthenticated worker configuration", () => {
    const valid = {
      workerId: "neon-lifecycle-test",
      connectionString: "postgresql://user@localhost:5432/db",
    };
    expect(() => createProductionNeonLifecycleReconciliationOperation({ ...valid, batchLimit: 0 })).toThrow();
    expect(() => createProductionNeonLifecycleReconciliationOperation({ ...valid, batchLimit: 5 })).toThrow();
    expect(() => createProductionNeonLifecycleReconciliationOperation({ ...valid, workerId: "" })).toThrow();
    expect(() => createProductionNeonLifecycleReconciliationOperation({ ...valid, connectionString: "" })).toThrow();
  });
});
