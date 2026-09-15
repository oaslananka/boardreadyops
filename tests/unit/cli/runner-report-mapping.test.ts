import { describe, expect, it } from "vitest";
import { runnerReportFromResult } from "../../../src/cli/runner-pipeline.js";
import type { RunResult } from "../../../src/core/result.js";

/**
 * Guards the mapping that silently dropped `result.boms`.
 *
 * The data was produced by the pipeline, serialised into the JSON report, and parsed back by the
 * runner -- and then not copied by a field-by-field object literal, so `board_bom_snapshots` was
 * never written and `resolveAffectedBoards` had no input despite the contract, the route and the
 * migration all being in place. The route tests POST a payload containing `boms` directly, so
 * they could not see that nothing built one. See #800.
 */

function result(overrides: Partial<RunResult> = {}): RunResult {
  return {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: "1.0.0" },
    summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0, maxSeverity: "none", failed: false },
    projects: [],
    findings: [],
    fabrication: { bom: [], outputs: [] },
    generatedAt: "2026-09-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("runnerReportFromResult", () => {
  it("carries the board BOMs the pipeline produced", () => {
    const mapped = runnerReportFromResult(
      result({
        boms: [{ project: "board.kicad_pro", components: [{ reference: "R1", mpn: "RC0603FR-0710KL" }] }],
      }),
    );

    expect(mapped.boms).toEqual([
      { project: "board.kicad_pro", components: [{ reference: "R1", mpn: "RC0603FR-0710KL" }] },
    ]);
  });

  it("carries the firmware dependencies the pipeline produced", () => {
    const mapped = runnerReportFromResult(
      result({
        firmware: {
          dependencies: [
            {
              name: "idf",
              manifestPath: "firmware/idf_component.yml",
              origin: "framework",
              versionSpec: "5.2.1",
              pinned: true,
              cpe: "cpe:2.3:a:espressif:esp-idf:5.2.1:*:*:*:*:*:*:*",
              searchable: true,
            },
          ],
          warnings: [],
        },
      }),
    );

    expect(mapped.firmware?.dependencies).toHaveLength(1);
    expect(mapped.firmware?.dependencies[0]?.cpe).toBe("cpe:2.3:a:espressif:esp-idf:5.2.1:*:*:*:*:*:*:*");
  });

  it("leaves both keys absent when the result has neither", () => {
    const mapped = runnerReportFromResult(result());

    // Absent rather than empty: an empty array would materialise the key on every hardware-only
    // run, and the contract keeps both optional with no default for that reason.
    expect(mapped).not.toHaveProperty("boms");
    expect(mapped).not.toHaveProperty("firmware");
  });

  it("leaves firmware absent when the section exists but has no dependencies", () => {
    const mapped = runnerReportFromResult(result({ firmware: { dependencies: [], warnings: ["unparsed"] } }));

    expect(mapped).not.toHaveProperty("firmware");
  });

  it("still carries the fields it always did", () => {
    const mapped = runnerReportFromResult(
      result({
        summary: { total: 2, critical: 1, high: 0, medium: 1, low: 0, info: 0, maxSeverity: "critical", failed: true },
      }),
    );

    expect(mapped.summary).toEqual({ total: 2, critical: 1, high: 0, medium: 1, low: 0, info: 0 });
    expect(mapped.findings).toEqual([]);
  });
});
