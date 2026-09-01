import { bench, describe } from "vitest";
import { buildHardwareImpact } from "../../src/core/diff/hardware-impact.js";
import { createFinding, summarizeFindings } from "../../src/core/findings.js";
import type { RunResult } from "../../src/core/result.js";
import { formatJson } from "../../src/report/json.js";
import { formatJunit } from "../../src/report/junit.js";
import { formatMarkdown } from "../../src/report/markdown.js";
import { formatSarif } from "../../src/report/sarif.js";

const findings = Array.from({ length: 25 }, (_, index) =>
  createFinding({
    ruleId: "bom.missing-mpn",
    severity: "medium",
    message: `R${index} is missing an MPN.`,
    resource: { path: "bom.csv", kind: "bom" },
  }),
);

const result: RunResult = {
  schemaVersion: 1,
  tool: { name: "boardreadyops", version: "0.9.0" },
  summary: summarizeFindings(findings, "high"),
  projects: [],
  findings,
  fabrication: { bom: [], outputs: [] },
  generatedAt: "2026-05-18T00:00:00.000Z",
};

const largeResultBaseline: RunResult = {
  schemaVersion: 1,
  tool: { name: "boardreadyops", version: "1.37.0" },
  summary: summarizeFindings(findings, "high"),
  projects: [],
  findings,
  fabrication: {
    bom: Array.from({ length: 150 }, (_, i) => ({ reference: `R${i}`, value: "10k", footprint: "0402" })),
    outputs: [{ kind: "gerber", files: [{ path: "top.gbr", digest: "aaa" }] }],
  },
  generatedAt: "2026-05-18T00:00:00.000Z",
};

const largeResultCandidate: RunResult = {
  schemaVersion: 1,
  tool: { name: "boardreadyops", version: "1.37.0" },
  summary: summarizeFindings(findings.slice(0, 20), "high"),
  projects: [],
  findings: findings.slice(0, 20),
  fabrication: {
    bom: Array.from({ length: 150 }, (_, i) => ({
      reference: `R${i}`,
      value: i % 2 === 0 ? "10k" : "12k",
      footprint: "0402",
    })),
    outputs: [{ kind: "gerber", files: [{ path: "top.gbr", digest: "bbb" }] }],
  },
  generatedAt: "2026-05-18T00:00:00.000Z",
};

describe("report formatters", () => {
  bench("JSON", () => {
    formatJson(result);
  });
  bench("SARIF", () => {
    formatSarif(result);
  });
  bench("Markdown", () => {
    formatMarkdown(result);
  });
  bench("JUnit", () => {
    formatJunit(result);
  });
  bench("Hardware Change Impact Large Fixture", () => {
    buildHardwareImpact({
      baseline: { status: "available", sha: "a".repeat(40), result: largeResultBaseline },
      candidate: { sha: "b".repeat(40), result: largeResultCandidate },
    });
  });
});
