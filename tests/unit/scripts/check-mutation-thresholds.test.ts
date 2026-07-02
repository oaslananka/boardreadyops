import { mkdir as fsMkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  calculateMutationMetrics,
  checkMutationThresholds,
  expectedCoreMutationFiles,
  formatFailures,
  formatMissingMutationFiles,
  formatMutationSummary,
  main,
  missingMutationFiles,
  missingRequiredMutationFiles,
} from "../../../scripts/check-mutation-thresholds.mjs";

describe("check-mutation-thresholds", () => {
  it("calculates Stryker mutation score from valid mutant statuses", () => {
    const report = reportWithFiles({
      "src/core/pipeline.ts": ["Killed", "Timeout", "Survived", "NoCoverage", "Ignored", "RuntimeError"],
      "src/rules/design.ts": ["Killed", "Survived"],
    });

    expect(calculateMutationMetrics(report)).toMatchObject({
      files: 2,
      killed: 2,
      timeout: 1,
      survived: 2,
      noCoverage: 1,
      totalDetected: 3,
      totalUndetected: 3,
      totalValid: 6,
    });
    expect(calculateMutationMetrics(report).mutationScore).toBe(50);
  });

  it("fails when core files are absent from the mutation report", () => {
    const results = checkMutationThresholds(reportWithFiles({ "src/rules/design.ts": ["Killed"] }));

    expect(formatFailures(results)).toContain(
      "src/core/** mutation threshold could not be checked because no report files matched src/core/**.",
    );
  });

  it("formats a GitHub job summary table", () => {
    const results = checkMutationThresholds(
      reportWithFiles({
        "src/core/pipeline.ts": ["Killed", "Killed", "Survived"],
        "src/rules/design.ts": ["Killed"],
      }),
    );

    expect(formatMutationSummary(results)).toContain("| Scope | Files | Score | Minimum |");
    expect(formatMutationSummary(results)).toContain("| src/core/** | 1 | 66.67% | 75.00% |");
  });

  it("reports executable core files missing from the Stryker report", () => {
    const missing = missingMutationFiles(reportWithFiles({ "src/core/pipeline.ts": ["Killed"] }), [
      "src/core/config.ts",
      "src/core/pipeline.ts",
    ]);

    expect(formatMissingMutationFiles(missing)).toEqual([
      "src/core/** mutation report is missing executable files:\nsrc/core/config.ts",
    ]);
  });

  it("excludes type-only and explicitly excluded core files from expected executable coverage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-mutation-files-"));
    await fsMkdir(path.join(root, "src", "core"), { recursive: true });
    await writeFile(path.join(root, "src", "core", "pipeline.ts"), "export const pipeline = true;\n");
    await writeFile(path.join(root, "src", "core", "config.types.ts"), "export interface Config {}\n");
    await writeFile(path.join(root, "src", "core", "context.ts"), "export const context = true;\n");
    await writeFile(path.join(root, "src", "core", "result.ts"), "export const result = true;\n");

    await expect(expectedCoreMutationFiles(root)).resolves.toEqual(["src/core/pipeline.ts"]);
  });

  it("appends the summary file and exits cleanly for passing reports", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-mutation-check-"));
    const reportPath = path.join(root, "mutation.json");
    const summaryPath = path.join(root, "summary.md");
    await writeFile(
      reportPath,
      JSON.stringify(
        reportWithFiles({
          "src/core/pipeline.ts": ["Killed", "Killed", "Killed", "Survived"],
          "src/kicad/sexpr.ts": ["Killed", "Killed", "Survived"],
          "src/kicad/pcb.ts": ["Killed"],
          "src/kicad/schematic.ts": ["Killed"],
          "src/kicad/schematic-graph.ts": ["Killed"],
          "src/rules/manufacturing/fiducials.ts": ["Killed"],
          "src/rules/manufacturing/jobset-outputs.ts": ["Killed"],
          "src/rules/manufacturing/layer-stackup.ts": ["Killed"],
          "src/rules/manufacturing/outputs-present.ts": ["Killed"],
          "src/rules/manufacturing/position-coverage.ts": ["Killed"],
          "src/rules/manufacturing/shared.ts": ["Killed"],
          "src/rules/manufacturing/tooling-holes.ts": ["Killed"],
          "src/rules/design.ts": ["Killed"],
        }),
      ),
    );

    await main(["--report", reportPath, "--summary-file", summaryPath], {}, root);

    expect(await readFile(summaryPath, "utf8")).toContain("## Mutation Score");
  });

  it("accepts the npm argument separator before script flags", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-mutation-check-"));
    const reportPath = path.join(root, "mutation.json");
    const summaryPath = path.join(root, "summary.md");
    await writeFile(
      reportPath,
      JSON.stringify(
        reportWithFiles({
          "src/core/pipeline.ts": ["Killed", "Killed", "Killed", "Survived"],
          "src/kicad/sexpr.ts": ["Killed", "Killed", "Survived"],
          "src/kicad/pcb.ts": ["Killed"],
          "src/kicad/schematic.ts": ["Killed"],
          "src/kicad/schematic-graph.ts": ["Killed"],
          "src/rules/manufacturing/fiducials.ts": ["Killed"],
          "src/rules/manufacturing/jobset-outputs.ts": ["Killed"],
          "src/rules/manufacturing/layer-stackup.ts": ["Killed"],
          "src/rules/manufacturing/outputs-present.ts": ["Killed"],
          "src/rules/manufacturing/position-coverage.ts": ["Killed"],
          "src/rules/manufacturing/shared.ts": ["Killed"],
          "src/rules/manufacturing/tooling-holes.ts": ["Killed"],
          "src/rules/design.ts": ["Killed"],
        }),
      ),
    );

    await main(["--", "--report", reportPath, "--summary-file", summaryPath], {}, root);

    expect(await readFile(summaryPath, "utf8")).toContain("| src/core/** | 1 | 75.00% | 75.00% |");
  });

  it("enforces parser and manufacturing mutation report coverage", () => {
    const report = reportWithFiles({
      "src/kicad/sexpr.ts": ["Killed"],
      "src/kicad/pcb.ts": ["Killed"],
      "src/kicad/schematic.ts": ["Survived"],
      "src/kicad/schematic-graph.ts": ["Killed"],
      "src/rules/manufacturing/fiducials.ts": ["Killed"],
      "src/rules/manufacturing/jobset-outputs.ts": ["Killed"],
      "src/rules/manufacturing/layer-stackup.ts": ["Killed"],
      "src/rules/manufacturing/outputs-present.ts": ["Killed"],
      "src/rules/manufacturing/position-coverage.ts": ["Killed"],
      "src/rules/manufacturing/shared.ts": ["Killed"],
    });

    const results = checkMutationThresholds(report);
    expect(formatMutationSummary(results)).toContain("| src/kicad/parser-model | 4 | 75.00% | 65.00% |");
    expect(formatMutationSummary(results)).toContain("| src/rules/manufacturing/** | 6 | 100.00% | 60.00% |");
    expect(missingRequiredMutationFiles(report)).toEqual([
      "src/rules/manufacturing/** mutation report is missing executable files:\nsrc/rules/manufacturing/tooling-holes.ts",
    ]);
  });
});

function reportWithFiles(files: Record<string, string[]>) {
  return {
    files: Object.fromEntries(
      Object.entries(files).map(([file, statuses]) => [
        file,
        {
          mutants: statuses.map((status, id) => ({ id: `${id}`, status })),
        },
      ]),
    ),
  };
}
