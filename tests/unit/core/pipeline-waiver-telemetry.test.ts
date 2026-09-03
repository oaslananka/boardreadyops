import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../../src/core/logger.js";
import { runPipeline } from "../../../src/core/pipeline.js";
import { clearRulesForTests, type Rule, registerRule } from "../../../src/core/rule-registry.js";

const fixtureDir = path.resolve(process.cwd(), "tests/fixtures/projects/jlcpcb-complete");

function memoryStream() {
  let text = "";
  return {
    stream: {
      write(value: string) {
        text += value;
        return true;
      },
    } as NodeJS.WritableStream,
    entries: () =>
      text
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe("Pipeline waiver false-positive telemetry", () => {
  it("logs a pipeline.waiver.false-positive event enriched with the rule's category/evidenceType", async () => {
    clearRulesForTests();
    const flaggingRule: Rule = {
      meta: {
        id: "custom.fp-rule",
        title: "Synthetic finding for false-positive telemetry",
        description: "Always reports one finding so a waiver can suppress it.",
        rationale: "Exercises the pipeline.waiver.false-positive telemetry hook end to end.",
        defaultSeverity: "medium",
        appliesTo: ["pcb"],
        configKeys: [],
        kicadVersions: ["9", "10"],
        tags: ["test"],
        category: "manufacturability",
        evidenceType: "heuristic",
        fixability: "manual",
        vendorDependence: "none",
      },
      run: async (context) => [
        {
          ruleId: "custom.fp-rule",
          severity: "medium" as const,
          message: "Synthetic finding.",
          resource: { path: `${context.root}/board.kicad_pcb`, kind: "pcb" as const },
          fingerprint: "synthetic-finding-fingerprint",
        },
      ],
    };

    registerRule(flaggingRule);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "brop-waiver-telemetry-test-"));
    const configPath = path.join(tempDir, "boardreadyops.yml");
    await fs.writeFile(
      configPath,
      `version: 1
waivers:
  - rule: custom.fp-rule
    owner: test-owner
    reason: "False positive: synthetic finding does not reflect a real board issue."
`,
      "utf8",
    );

    const memory = memoryStream();
    const logger = createLogger({ level: "info", format: "json", stream: memory.stream });

    try {
      const result = await runPipeline(
        {
          path: fixtureDir,
          config: configPath,
          rules: ["custom.fp-rule"],
        },
        logger,
      );

      const suppressed = result.findings?.find((finding) => finding.ruleId === "custom.fp-rule");
      expect(suppressed?.suppressed).toBe(true);

      const events = memory.entries().filter((entry) => entry.event === "pipeline.waiver.false-positive");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        rule: "custom.fp-rule",
        category: "manufacturability",
        evidenceType: "heuristic",
        fingerprint: "synthetic-finding-fingerprint",
        reason: "False positive: synthetic finding does not reflect a real board issue.",
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
      clearRulesForTests();
    }
  });

  it("does not log a false-positive event when no waiver reason mentions a false positive", async () => {
    clearRulesForTests();
    const flaggingRule: Rule = {
      meta: {
        id: "custom.fp-rule-quiet",
        title: "Synthetic finding for an ordinary waiver",
        description: "Always reports one finding so an accepted-risk waiver can suppress it.",
        rationale: "Confirms the telemetry hook stays silent for non-false-positive waivers.",
        defaultSeverity: "low",
        appliesTo: ["pcb"],
        configKeys: [],
        kicadVersions: ["9", "10"],
        tags: ["test"],
        category: "sourcing",
        evidenceType: "exact",
        fixability: "manual",
        vendorDependence: "none",
      },
      run: async (context) => [
        {
          ruleId: "custom.fp-rule-quiet",
          severity: "low" as const,
          message: "Synthetic finding.",
          resource: { path: `${context.root}/board.kicad_pcb`, kind: "pcb" as const },
          fingerprint: "synthetic-finding-fingerprint-quiet",
        },
      ],
    };

    registerRule(flaggingRule);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "brop-waiver-telemetry-quiet-test-"));
    const configPath = path.join(tempDir, "boardreadyops.yml");
    await fs.writeFile(
      configPath,
      `version: 1
waivers:
  - rule: custom.fp-rule-quiet
    owner: test-owner
    reason: "Accepted risk for this release."
`,
      "utf8",
    );

    const memory = memoryStream();
    const logger = createLogger({ level: "info", format: "json", stream: memory.stream });

    try {
      const result = await runPipeline(
        {
          path: fixtureDir,
          config: configPath,
          rules: ["custom.fp-rule-quiet"],
        },
        logger,
      );

      const suppressed = result.findings?.find((finding) => finding.ruleId === "custom.fp-rule-quiet");
      expect(suppressed?.suppressed).toBe(true);

      const events = memory.entries().filter((entry) => entry.event === "pipeline.waiver.false-positive");
      expect(events).toHaveLength(0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
      clearRulesForTests();
    }
  });
});
