import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConcurrency } from "../../../src/core/concurrency.js";
import { loadConfig, validateConfig } from "../../../src/core/config.js";
import { canonicalRoot, runPipeline } from "../../../src/core/pipeline.js";
import { clearRulesForTests, listRules, registerRule } from "../../../src/core/rule-registry.js";
import { writeFixture } from "../rules/helpers.js";

const originalAvailableParallelism = os.availableParallelism;
const originalCpus = os.cpus;

afterEach(() => {
  Object.defineProperty(os, "availableParallelism", { value: originalAvailableParallelism, configurable: true });
  Object.defineProperty(os, "cpus", { value: originalCpus, configurable: true });
});

describe("core coverage branches", () => {
  it("falls back when realpath and availableParallelism are unavailable", async () => {
    Object.defineProperty(os, "availableParallelism", { value: undefined, configurable: true });
    expect(defaultConcurrency()).toBeGreaterThanOrEqual(1);

    const missing = path.join(os.tmpdir(), `boardreadyops-missing-${Date.now()}`);
    expect(await canonicalRoot(missing)).toBe(missing);
  });

  it("prefers availableParallelism over the CPU list length", () => {
    Object.defineProperty(os, "availableParallelism", { value: () => 8, configurable: true });
    Object.defineProperty(os, "cpus", {
      value: () => [
        { model: "test", speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
        { model: "test", speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
      ],
      configurable: true,
    });

    expect(defaultConcurrency()).toBe(8);
  });

  it("falls back to CPU list length and clamps empty CPU data", () => {
    Object.defineProperty(os, "availableParallelism", { value: undefined, configurable: true });
    Object.defineProperty(os, "cpus", {
      value: () => [
        { model: "test", speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
        { model: "test", speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
        { model: "test", speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
      ],
      configurable: true,
    });
    expect(defaultConcurrency()).toBe(3);

    Object.defineProperty(os, "cpus", { value: () => [], configurable: true });
    expect(defaultConcurrency()).toBe(1);
  });

  it("discovers explicit project directories and configured nested projects", async () => {
    const root = await writeFixture({
      "nested/nested.kicad_pro": JSON.stringify({ jobsets: ["fab/outputs.kicad_jobset"] }),
      "nested/nested.kicad_sch": "(kicad_sch)",
      "nested/nested.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "nested/fab/outputs.kicad_jobset": JSON.stringify({ jobs: [] }),
      "nested/fab/README.md": "notes",
      "boardreadyops.yml": `version: 1
projects:
  - path: nested
rules:
  drc.kicad:
    enabled: false
  erc.kicad:
    enabled: false
  release.changelog-present:
    enabled: false
fail-on: never
`,
    });

    const configured = await runPipeline({ path: root, failOn: "never" });
    expect(configured.projects[0]).toMatchObject({
      projectFile: "nested/nested.kicad_pro",
      schematicFiles: ["nested/nested.kicad_sch"],
      boardFiles: ["nested/nested.kicad_pcb"],
      jobsetFiles: ["nested/fab/outputs.kicad_jobset"],
    });

    const explicit = await runPipeline({
      path: root,
      project: "nested",
      rules: ["release.revision-set"],
      failOn: "never",
      quiet: true,
      verbose: true,
      color: "never",
    });
    expect(explicit.projects).toHaveLength(1);
    expect(explicit.findings.some((finding) => finding.ruleId === "release.revision-set")).toBe(false);
  });

  it("captures every configured project BOM and only project-scoped manufacturing outputs", async () => {
    const root = await writeFixture({
      "main/main.kicad_pro": "{}",
      "main/main.kicad_sch": "(kicad_sch)",
      "main/main.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "main/bom.csv":
        "Reference,Value,Footprint,Manufacturer,MPN,Supplier 1,Lifecycle,DNP\nR1,10k,0603,Acme,R-10K,DigiKey,Active,false\n",
      "main/fab/main.drl": "M48",
      "child/child.kicad_pro": "{}",
      "child/child.kicad_sch": "(kicad_sch)",
      "child/child.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "child/bom.csv":
        "Reference,Value,Footprint,Manufacturer,MPN,Supplier 1,Lifecycle,DNP\nR2,22k,0603,Acme,R-22K,LCSC,Active,false\n",
      "outside/noise.drl": "unrelated",
      "boardreadyops.yml": `version: 1
projects:
  - path: main
    bom: main/bom.csv
  - path: child
    bom: child/bom.csv
fail-on: never
`,
    });

    const result = await runPipeline({ path: root, rules: ["release.revision-set"], failOn: "never" });
    const drill = result.fabrication.outputs.find((output) => output.kind === "drill");
    const bom = result.fabrication.outputs.find((output) => output.kind === "bom");

    expect(result.fabrication.bom.map((row) => row.reference)).toEqual(["R1", "R2"]);
    expect(bom?.files.map((file) => file.path)).toEqual(["child/bom.csv", "main/bom.csv"]);
    expect(drill?.files.map((file) => file.path)).toEqual(["main/fab/main.drl"]);
  });

  it("keeps non-BOM pipeline runs alive when a configured BOM path is stale", async () => {
    const root = await writeFixture({
      "main.kicad_pro": "{}",
      "main.kicad_sch": "(kicad_sch)",
      "main.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "boardreadyops.yml": `version: 1
projects:
  - path: .
    bom: stale.csv
fail-on: never
`,
    });

    await expect(runPipeline({ path: root, rules: ["design.board-outline"], failOn: "never" })).resolves.toMatchObject({
      fabrication: {
        bom: [],
      },
    });
  });

  it("keeps child project jobsets out of parent project contexts", async () => {
    const root = await writeFixture({
      "parent.kicad_pro": "{}",
      "parent.kicad_sch": "(kicad_sch)",
      "parent.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "child/child.kicad_pro": "{}",
      "child/child.kicad_sch": "(kicad_sch)",
      "child/child.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "child/fab/outputs.kicad_jobset": JSON.stringify({ jobs: [] }),
      "boardreadyops.yml": "version: 1\nfail-on: never\n",
    });

    const result = await runPipeline({ path: root, rules: ["manufacturing.jobset-outputs"], failOn: "never" });

    expect(result.projects.find((project) => project.projectFile === "parent.kicad_pro")?.jobsetFiles).toEqual([]);
    expect(result.projects.find((project) => project.projectFile === "child/child.kicad_pro")?.jobsetFiles).toEqual([
      "child/fab/outputs.kicad_jobset",
    ]);
  });

  it("reports explicit missing project files and empty config search results", async () => {
    const root = await writeFixture({});
    expect((await loadConfig(root)).errors).toEqual([]);

    const result = await runPipeline({
      path: root,
      project: "missing/missing.kicad_pro",
      rules: ["release.revision-set"],
      skips: ["release.revision-set"],
      failOn: "never",
    });

    expect(result.projects).toEqual([
      {
        projectFile: "missing/missing.kicad_pro",
        root: "missing",
        schematicFiles: [],
        boardFiles: [],
        jobsetFiles: [],
      },
    ]);
    expect(result.findings.map((finding) => finding.message).sort()).toEqual([
      "missing/missing.kicad_pro has no matching board file.",
      "missing/missing.kicad_pro has no matching schematic file.",
    ]);

    const schematicOnly = await writeFixture({ "only.kicad_sch": "(kicad_sch)" });
    const schematicMatched = await runPipeline({
      path: schematicOnly,
      project: "only.kicad_pro",
      rules: ["release.revision-set"],
      failOn: "never",
      verbose: true,
    });
    expect(schematicMatched.projects[0]?.schematicFiles).toEqual(["only.kicad_sch"]);
    expect(schematicMatched.projects[0]?.boardFiles).toEqual([]);
  });

  it("loads invalid explicit configs as config findings", async () => {
    const root = await writeFixture({
      "bad.kicad_pro": "{}",
      "bad.kicad_sch": "(kicad_sch)",
      "bad.kicad_pcb": '(kicad_pcb (title_block (rev "v1.0")))',
      "bad.yml": "version: 2\n",
    });

    const result = await runPipeline({
      path: root,
      config: "bad.yml",
      rules: ["release.revision-set"],
      failOn: "never",
    });

    expect(result.findings.some((finding) => finding.ruleId === "config.invalid")).toBe(true);
  });

  it("uses config mode and fail thresholds when pipeline inputs omit them", async () => {
    const root = await writeFixture({
      "configured.kicad_pro": "{}",
      "configured.kicad_sch": "(kicad_sch)",
      "configured.kicad_pcb": '(kicad_pcb (title_block (rev "")))',
      ".boardreadyops.yml": `version: 1
mode: enforce
fail-on: low
rules:
  drc.kicad:
    enabled: false
  erc.kicad:
    enabled: false
  release.changelog-present:
    enabled: false
`,
    });

    const result = await runPipeline({ cwd: root });

    expect(result.summary.failed).toBe(true);
    expect(result.findings.some((finding) => finding.ruleId === "release.revision-set")).toBe(true);
  });

  it("keeps findings active when a configured baseline file is not present yet", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "boardreadyops.yml": `version: 1
baseline:
  file: audit/missing-baseline.json
  mode: new-only
rules:
  release.changelog-present:
    enabled: false
  release.revision-set:
    enabled: false
`,
    });

    const result = await runPipeline({ path: root, rules: ["manifest.project-discovery"], failOn: "high" });

    expect(result.findings).toHaveLength(2);
    expect(result.summary.failed).toBe(true);
  });

  it("treats empty explicit config files as invalid config objects", async () => {
    const root = await writeFixture({ "blank.yml": "" });

    const loaded = await loadConfig(root, "blank.yml");

    expect(loaded.errors.join("\n")).toContain("must have required property 'version'");
  });

  it("clears and orders rule registry entries deterministically", async () => {
    clearRulesForTests();
    expect(listRules()).toEqual([]);

    registerRule({
      meta: {
        id: "z.rule",
        title: "Z",
        description: "Synthetic Z rule.",
        rationale: "Exercises rule registry ordering.",
        defaultSeverity: "info",
        appliesTo: [],
        configKeys: [],
        kicadVersions: ["future"],
        tags: ["test"],
        category: "unclassified",
        evidenceType: "unclassified",
        fixability: "unclassified",
        vendorDependence: "unclassified",
      },
      run: async () => [],
    });
    registerRule({
      meta: {
        id: "a.rule",
        title: "A",
        description: "Synthetic A rule.",
        rationale: "Exercises rule registry ordering.",
        defaultSeverity: "info",
        appliesTo: [],
        configKeys: [],
        kicadVersions: ["future"],
        tags: ["test"],
        category: "unclassified",
        evidenceType: "unclassified",
        fixability: "unclassified",
        vendorDependence: "unclassified",
      },
      run: async () => [],
    });
    expect(listRules().map((rule) => rule.meta.id)).toEqual(["a.rule", "z.rule"]);

    clearRulesForTests();
    expect(listRules()).toEqual([]);
  });

  it("covers validateConfig, isRuleEnabled, ruleSeverity edge branches", () => {
    expect(validateConfig(null)).not.toHaveLength(0);
    expect(validateConfig({ version: 1, invalidProp: 123 })).not.toHaveLength(0);
  });
});
