import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPipeline } from "../../../src/core/pipeline.js";
import { clearRulesForTests, type Rule, registerRule } from "../../../src/core/rule-registry.js";

const fixtureDir = path.resolve(process.cwd(), "tests/fixtures/projects/jlcpcb-complete");

describe("Pipeline Rule Performance Budget & Timeout", () => {
  it("enforces configured per-rule timeout when a rule hangs or exceeds duration", async () => {
    clearRulesForTests();
    const slowRule: Rule = {
      meta: {
        id: "custom.slow-rule",
        title: "Slow Rule",
        description: "A rule that delays execution",
        rationale: "Testing timeout mechanisms",
        defaultSeverity: "high",
        appliesTo: ["pcb"],
        configKeys: [],
        kicadVersions: ["9", "10"],
        tags: ["test"],
      },
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return [];
      },
    };

    registerRule(slowRule);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "brop-timeout-test-"));
    const configPath = path.join(tempDir, "boardreadyops.yml");
    await fs.writeFile(
      configPath,
      `version: 1
rules:
  custom.slow-rule:
    timeout: 30
`,
      "utf8",
    );

    try {
      await expect(
        runPipeline({
          path: fixtureDir,
          config: configPath,
          rules: ["custom.slow-rule"],
        }),
      ).rejects.toThrow(/timed out after 30ms/);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
      clearRulesForTests();
    }
  });

  it("passes when rule completes within the configured timeout budget", async () => {
    clearRulesForTests();
    const fastRule: Rule = {
      meta: {
        id: "custom.fast-rule",
        title: "Fast Rule",
        description: "A rule that executes quickly",
        rationale: "Testing fast execution",
        defaultSeverity: "low",
        appliesTo: ["pcb"],
        configKeys: [],
        kicadVersions: ["9", "10"],
        tags: ["test"],
      },
      run: async () => [],
    };

    registerRule(fastRule);

    const result = await runPipeline({
      path: fixtureDir,
      rules: ["custom.fast-rule"],
    });

    expect(result.summary.failed).toBe(false);
    clearRulesForTests();
  });

  it("does not apply a timeout race when the rule config object has no numeric timeout", async () => {
    clearRulesForTests();
    const untimedRule: Rule = {
      meta: {
        id: "custom.untimed-rule",
        title: "Untimed Rule",
        description: "A rule configured as an object but without a timeout field",
        rationale: "Testing that an object rule config without `timeout` doesn't spuriously race",
        defaultSeverity: "low",
        appliesTo: ["pcb"],
        configKeys: [],
        kicadVersions: ["9", "10"],
        tags: ["test"],
      },
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return [];
      },
    };

    registerRule(untimedRule);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "brop-no-timeout-test-"));
    const configPath = path.join(tempDir, "boardreadyops.yml");
    await fs.writeFile(
      configPath,
      `version: 1
rules:
  custom.untimed-rule:
    enabled: true
`,
      "utf8",
    );

    try {
      const result = await runPipeline({
        path: fixtureDir,
        config: configPath,
        rules: ["custom.untimed-rule"],
      });
      expect(result.summary.failed).toBe(false);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
      clearRulesForTests();
    }
  });

  it("aborts execution promptly when AbortSignal is triggered", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runPipeline({
        path: fixtureDir,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});
