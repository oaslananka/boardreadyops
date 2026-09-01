import { describe, expect, it } from "vitest";
import { executionStatusIds, validateExecutionStatus } from "../../../scripts/master-execution-status.mjs";

type TestWorkstream = {
  id: string;
  name: string;
  phase: number;
  priority: string;
  status: string;
  owner: string;
  dependencies: string[];
  milestone: string;
  issues: number[];
  evidence: Record<string, string[]>;
  verification: { command: string; result: string; checkedAt: string };
  remaining?: string;
  deferUntil?: string;
};

function workstream(id: string, phase = 0): TestWorkstream {
  return {
    id,
    name: `Workstream ${id}`,
    phase,
    priority: "P0",
    status: "missing",
    owner: "maintainers",
    dependencies: [],
    milestone: "Repository Maintenance & Release Health",
    issues: [191],
    evidence: { code: [], tests: [], docs: [], deployed: [], commits: [], pullRequests: [] },
    verification: { command: "not run", result: "not_run", checkedAt: "2026-09-01T00:00:00Z" },
    remaining: "Repository evidence has not been reconciled.",
  };
}

function validLedger() {
  return {
    version: 1,
    spec: {
      path: "BoardReadyOps_Agent_Master_Development_Spec.md",
      sha256: "e02df14e4105945ac1d8bb8dc13d132e04dd27803e560288548f9c3e60857c62",
    },
    roadmap: {
      source: "https://github.com/oaslananka/boardreadyops/issues/191",
      checkedAt: "2026-09-01T00:00:00Z",
      orderedMilestones: ["Repository Maintenance & Release Health"],
      completedMilestones: ["v1.8.0 — Release & Distribution Reliability"],
    },
    baseline: {
      command: "task verify",
      result: "not_run",
      commit: "0831efc",
      checkedAt: "2026-09-01T00:00:00Z",
      blockers: [],
    },
    workstreams: executionStatusIds.map((id) => workstream(id)),
  };
}

describe("master execution status validation", () => {
  it("accepts exactly W00 through W36", () => {
    expect(validateExecutionStatus(validLedger()).workstreams).toHaveLength(37);
  });

  it("rejects a missing workstream", () => {
    const ledger = validLedger();
    ledger.workstreams.pop();
    expect(() => validateExecutionStatus(ledger)).toThrow("missing workstream W36");
  });

  it("rejects a duplicate workstream", () => {
    const ledger = validLedger();
    ledger.workstreams.push(workstream("W00"));
    expect(() => validateExecutionStatus(ledger)).toThrow("duplicate workstream W00");
  });

  it("rejects a dependency cycle", () => {
    const ledger = validLedger();
    ledger.workstreams[0].dependencies = ["W01"];
    ledger.workstreams[1].dependencies = ["W00"];
    expect(() => validateExecutionStatus(ledger)).toThrow("dependency cycle: W00 -> W01 -> W00");
  });

  it("rejects implemented work without complete evidence", () => {
    const ledger = validLedger();
    ledger.workstreams[0] = { ...ledger.workstreams[0], status: "implemented", remaining: undefined };
    expect(() => validateExecutionStatus(ledger)).toThrow("W00 implemented evidence missing");
  });
});
