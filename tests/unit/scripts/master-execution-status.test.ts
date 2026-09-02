import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  executionStatusIds,
  main,
  renderExecutionStatus,
  replaceExecutionStatusSection,
  validateExecutionDetailsSection,
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
      verified: false,
      provenance: "Supplied out-of-band; not present in this repository as of this audit.",
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

  it("rejects an unverified spec without a provenance explanation", () => {
    const ledger = validLedger();
    ledger.spec = { path: ledger.spec.path, sha256: ledger.spec.sha256, verified: false, provenance: "" };
    expect(() => validateExecutionStatus(ledger)).toThrow("spec provenance missing");
  });

  it("rejects a verified spec whose path does not exist", () => {
    const ledger = validLedger();
    ledger.spec = { ...ledger.spec, verified: true };
    expect(() => validateExecutionStatus(ledger, { pathExists: () => false })).toThrow(
      "spec path missing: BoardReadyOps_Agent_Master_Development_Spec.md",
    );
  });

  it("rejects a verified spec whose digest does not match the file", () => {
    const ledger = validLedger();
    ledger.spec = { ...ledger.spec, verified: true };
    expect(() => validateExecutionStatus(ledger, { pathExists: () => true, readSha256: () => "0".repeat(64) })).toThrow(
      "spec sha256 mismatch",
    );
  });

  it("accepts a verified spec whose digest matches the file content", () => {
    const content = "master spec content";
    const digest = createHash("sha256").update(content).digest("hex");
    const ledger = validLedger();
    ledger.spec = { ...ledger.spec, sha256: digest, verified: true };
    expect(() => validateExecutionStatus(ledger, { pathExists: () => true, readSha256: () => digest })).not.toThrow();
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
    const details = executionStatusIds
      .map((id) => `### ${id} — Workstream ${id}\n- **Status:** \`Missing\`\n`)
      .join("\n");
    await writeFile(
      join(root, "docs", "development", "master-execution-status.md"),
      `before\n<!-- master-execution-status:start -->\nold\n<!-- master-execution-status:end -->\n${details}\nafter\n`,
    );

    await expect(main(root, ["check"])).rejects.toThrow("master execution status drift");
    await main(root, ["render"]);
    await expect(main(root, ["check"])).resolves.toBeUndefined();
    expect(await readFile(join(root, "docs", "development", "master-execution-status.md"), "utf8")).toContain(
      "| W00 |",
    );
  });
});

describe("master execution status details section", () => {
  function detailsDoc(statusLine: string) {
    return executionStatusIds.map((id) => `### ${id} — Workstream ${id}\n${statusLine}\n`).join("\n");
  }

  it("accepts a details section whose statuses match the ledger", () => {
    const status = validateExecutionStatus(validLedger());
    expect(() => validateExecutionDetailsSection(detailsDoc("- **Status:** `Missing`"), status)).not.toThrow();
  });

  it("rejects a details section whose status contradicts the ledger", () => {
    const ledger = validLedger();
    const first = ledger.workstreams[0];
    if (!first) throw new Error("test fixture workstream missing");
    first.status = "implemented";
    delete first.remaining;
    first.evidence = {
      code: ["package.json"],
      tests: ["package.json"],
      docs: ["package.json"],
      deployed: ["package.json"],
      commits: ["abc123"],
      pullRequests: [],
    };
    first.verification.result = "pass";
    const status = validateExecutionStatus(ledger);
    expect(() => validateExecutionDetailsSection(detailsDoc("- **Status:** `Missing`"), status)).toThrow(
      "execution status details drift: W00 Section 3 says",
    );
  });

  it("rejects a details section missing a workstream entry", () => {
    const status = validateExecutionStatus(validLedger());
    const doc = executionStatusIds
      .filter((id) => id !== "W36")
      .map((id) => `### ${id} — Workstream ${id}\n- **Status:** \`Missing\`\n`)
      .join("\n");
    expect(() => validateExecutionDetailsSection(doc, status)).toThrow(
      "execution status details: missing Section 3 entry for W36",
    );
  });
});
