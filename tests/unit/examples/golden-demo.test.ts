import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../../src/cli/index.js";
import { runPipeline } from "../../../src/core/pipeline.js";

const demoRoot = path.resolve("examples/golden-demo");

// docs/quickstart.md ("Golden Demo Run"), docs/golden-demo.md ("Run it in two commands"),
// docs/product/golden-demo-repositories.md, and docs/ROADMAP.md (Epic #277) all promise a
// new user can evaluate BoardReadyOps against the golden demo in under two minutes. Actual
// wall-clock cost of the two documented commands is on the order of tens of milliseconds, so
// this ceiling leaves large CI slack without risking flakiness.
const GOLDEN_DEMO_TIME_BUDGET_MS = 120_000;

function memoryStreams(): { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream } {
  return {
    stdout: { write: () => true },
    stderr: { write: () => true },
  } as unknown as { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream };
}

async function readExpected(): Promise<{ broken: string[]; fixed: string[] }> {
  const raw = await fs.readFile(path.join(demoRoot, "expected-findings.json"), "utf8");
  return JSON.parse(raw) as { broken: string[]; fixed: string[] };
}

function ruleIds(findings: ReadonlyArray<{ ruleId: string }>): string[] {
  return [...new Set(findings.map((finding) => finding.ruleId))].sort();
}

describe("golden demo corpus", () => {
  it("the broken board reports exactly the documented findings and fails", async () => {
    const expected = await readExpected();
    const result = await runPipeline({ path: path.join(demoRoot, "broken"), failOn: "high" });

    expect(ruleIds(result.findings)).toEqual([...expected.broken].sort());
    expect(result.summary.failed).toBe(true);
  });

  it("the fixed board clears every documented finding and passes", async () => {
    const expected = await readExpected();
    const result = await runPipeline({ path: path.join(demoRoot, "fixed"), failOn: "high" });

    expect(ruleIds(result.findings)).toEqual([...expected.fixed].sort());
    expect(result.summary.failed).toBe(false);
  });

  it(
    "runs the documented two-command walkthrough end-to-end within the golden-demo time budget",
    async () => {
      const started = performance.now();
      const brokenExitCode = await runCli(["run", path.join(demoRoot, "broken")], memoryStreams());
      const fixedExitCode = await runCli(["run", path.join(demoRoot, "fixed")], memoryStreams());
      const durationMs = performance.now() - started;

      expect(brokenExitCode).toBe(1);
      expect(fixedExitCode).toBe(0);
      expect(durationMs).toBeLessThan(GOLDEN_DEMO_TIME_BUDGET_MS);
    },
    GOLDEN_DEMO_TIME_BUDGET_MS + 10_000,
  );
});
