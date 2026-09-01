import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  executionStatusIds,
  main,
  renderExecutionStatus,
  replaceExecutionStatusSection,
  validateExecutionStatus,
} from "../../../scripts/master-execution-status.mjs";

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
    const first = ledger.workstreams[0];
    const second = ledger.workstreams[1];
    if (!first || !second) throw new Error("test fixture workstreams missing");
    first.dependencies = ["W01"];
    second.dependencies = ["W00"];
    expect(() => validateExecutionStatus(ledger)).toThrow("dependency cycle: W00 -> W01 -> W00");
  });

  it("rejects implemented work without complete evidence", () => {
    const ledger = validLedger();
    const first = ledger.workstreams[0];
    if (!first) throw new Error("test fixture workstream missing");
    first.status = "implemented";
    delete first.remaining;
    expect(() => validateExecutionStatus(ledger)).toThrow("W00 implemented evidence missing");
  });
});

describe("master execution status rendering", () => {
  it("renders workstreams in phase, priority, and ID order", () => {
    const ledger = validLedger();
    ledger.workstreams.reverse();
    const rendered = renderExecutionStatus(validateExecutionStatus(ledger));
    expect(rendered.indexOf("| W00 |")).toBeLessThan(rendered.indexOf("| W36 |"));
  });

  it("replaces only the generated section", () => {
    const input = "before\n<!-- master-execution-status:start -->\nold\n<!-- master-execution-status:end -->\nafter\n";
    expect(replaceExecutionStatusSection(input, "new")).toBe(
      "before\n<!-- master-execution-status:start -->\nnew\n<!-- master-execution-status:end -->\nafter\n",
    );
  });

  it("rejects a document without both generated markers", () => {
    expect(() => replaceExecutionStatusSection("before", "new")).toThrow("generated execution status markers missing");
  });

  it("renders drift and then accepts check mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "boardreadyops-execution-status-"));
    await mkdir(join(root, "docs", "development"), { recursive: true });
    await writeFile(
      join(root, "docs", "development", "master-execution-status.json"),
      `${JSON.stringify(validLedger(), null, 2)}\n`,
    );
    await writeFile(
      join(root, "docs", "development", "master-execution-status.md"),
      "before\n<!-- master-execution-status:start -->\nold\n<!-- master-execution-status:end -->\nafter\n",
    );

    await expect(main(root, ["check"])).rejects.toThrow("master execution status drift");
    await main(root, ["render"]);
    await expect(main(root, ["check"])).resolves.toBeUndefined();
    expect(await readFile(join(root, "docs", "development", "master-execution-status.md"), "utf8")).toContain(
      "| W00 |",
    );
  });
});
