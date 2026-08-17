import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../../src/core/config.js";
import type { RuleContext } from "../../../../src/core/context.js";
import { discoverProjects } from "../../../../src/core/discovery.js";
import { createLogger } from "../../../../src/core/logger.js";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { outputsPresentRule } from "../../../../src/rules/manufacturing/outputs-present.js";
import { globFiles } from "../../../../src/util/glob.js";
import { copyFixture, expectRule, runFixture, writeFixture } from "../helpers.js";

describe("manufacturing.outputs-present", () => {
  it("flags missing required manufacturing outputs", async () => {
    const result = await runFixture("manufacturing-missing-outputs");
    const findings = expectRule(result, "manufacturing.outputs-present");
    expect(findings.map((finding) => finding.details?.required)).toContain("gerber");
  });

  it.each(["jlcpcb-layout", "pcbway-layout", "aisler-layout", "oshpark-layout", "custom-layout"])(
    "detects vendor and custom output layouts in %s",
    async (fixture) => {
      const result = await runFreshVendorFixture(fixture);

      expectRule(result, "manufacturing.outputs-present", 0);
    },
    15_000,
  );

  it("uses selected vendor profile evidence requirements", async () => {
    const root = await writeFixture({
      "vendor.kicad_pro": "{}",
      "vendor.kicad_pcb": "(kicad_pcb)",
      "vendor.kicad_sch": "(kicad_sch)",
      "boardreadyops.yml": `version: 1
vendor:
  profile: jlcpcb
  service: assembly
rules:
  manufacturing.outputs-present:
    enabled: true
fail-on: never
`,
    });

    const findings = expectRule(
      await runPipeline({ path: root, rules: ["manufacturing.outputs-present"], failOn: "never" }),
      "manufacturing.outputs-present",
      2,
    );
    expect(findings.map((finding) => finding.details?.required).sort()).toEqual(["bom", "position"]);
    expect(findings.every((finding) => finding.details?.vendorProfile === "jlcpcb")).toBe(true);
  });

  it("does not treat unrelated XML files as BOM outputs", async () => {
    const root = await writeFixture({
      "xml-no-bom.kicad_pro": "{}",
      "xml-no-bom.kicad_pcb": "(kicad_pcb)",
      "xml-no-bom.kicad_sch": "(kicad_sch)",
      "metadata.xml": "<tool-metadata />",
      "boardreadyops.yml": `version: 1
rules:
  manufacturing.outputs-present:
    enabled: true
    required: [bom]
fail-on: never
`,
    });

    const findings = expectRule(
      await runPipeline({ path: root, rules: ["manufacturing.outputs-present"], failOn: "never" }),
      "manufacturing.outputs-present",
      1,
    );
    expect(findings[0]?.details?.required).toBe("bom");
  });

  it("explains searched patterns, found files, and missing outputs", async () => {
    const root = path.resolve("tests/fixtures/projects/manufacturing-missing-outputs");
    const loaded = await loadConfig(root);
    const explanation = await outputsPresentRule.explain?.({
      root,
      projects: await discoverProjects(root),
      config: loaded.config,
      options: {
        cwd: process.cwd(),
        path: root,
        project: undefined,
        config: undefined,
        mode: "warn",
        requireKicad: false,
        kicadCli: undefined,
        bom: undefined,
        pinmap: undefined,
        variant: undefined,
        concurrency: 1,
        failOn: "never",
        gate: undefined,
        rules: ["manufacturing.outputs-present"],
        skips: [],
        ignoreBaseline: false,
        annotations: false,
        quiet: true,
        verbose: false,
        color: "auto",
      },
      logger: createLogger("silent"),
    } satisfies RuleContext);

    expect(explanation?.sections.find((section) => section.title === "Searched patterns")?.lines).toContainEqual(
      expect.stringContaining("gerber:"),
    );
    expect(explanation?.sections.find((section) => section.title === "Found")?.lines).toContain("gerber: none");
    expect(explanation?.sections.find((section) => section.title === "Missing")?.lines).toContain("gerber");

    const foundRoot = path.resolve("tests/fixtures/projects/custom-layout");
    const foundConfig = await loadConfig(foundRoot);
    const foundExplanation = await outputsPresentRule.explain?.({
      ...explanationContext(foundRoot, foundConfig.config),
      projects: await discoverProjects(foundRoot),
    });

    expect(foundExplanation?.sections.find((section) => section.title === "Found")?.lines).toContain(
      "gerber: vendor/custom_path/release/top.fab",
    );
  });

  it("explains stale manufacturing outputs", async () => {
    const root = await copyFixture("manufacturing-stale-outputs");
    await fs.utimes(path.join(root, "old.drl"), new Date(0), new Date(0));
    const loaded = await loadConfig(root);
    const explanation = await outputsPresentRule.explain?.({
      ...explanationContext(root, loaded.config),
      projects: await discoverProjects(root),
    });

    expect(explanation?.sections.find((section) => section.title === "Missing")?.lines).toContain("drill: stale");
  });
});

async function runFreshVendorFixture(fixture: string) {
  const root = await copyFixture(fixture);
  const outputFiles = await globFiles(root, [
    "**/*.gbr",
    "**/*.gtl",
    "**/*.gm1",
    "**/*.drl",
    "**/*.xln",
    "**/*.ncd",
    "**/*.cnc",
    "**/*.pos",
    "**/*.csv",
    "**/*.xml",
    "**/*.xlsx",
    "**/*.fab",
  ]);
  const freshTime = new Date(Date.now() + 1000);
  await Promise.all(outputFiles.map((file) => fs.utimes(file, freshTime, freshTime)));
  return runPipeline({ path: root, rules: ["manufacturing.outputs-present"], failOn: "never" });
}

function explanationContext(root: string, config: RuleContext["config"]): RuleContext {
  return {
    root,
    projects: [],
    config,
    options: {
      cwd: process.cwd(),
      path: root,
      project: undefined,
      config: undefined,
      mode: "warn",
      requireKicad: false,
      kicadCli: undefined,
      bom: undefined,
      pinmap: undefined,
      variant: undefined,
      concurrency: 1,
      failOn: "never",
      gate: undefined,
      rules: ["manufacturing.outputs-present"],
      skips: [],
      ignoreBaseline: false,
      annotations: false,
      quiet: true,
      verbose: false,
      color: "auto",
    },
    logger: createLogger("silent"),
  };
}
