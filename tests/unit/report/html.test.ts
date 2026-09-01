import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Window } from "happy-dom";
import { HtmlValidate } from "html-validate";
import { describe, expect, it } from "vitest";
import { writeReports } from "../../../src/cli/output.js";
import { type LoadedConfig, validateConfig } from "../../../src/core/config.js";
import type { FabricationDiff } from "../../../src/core/diff/fabrication.js";
import { createFinding, summarizeFindings } from "../../../src/core/findings.js";
import type { RunResult } from "../../../src/core/result.js";
import { formatHtml } from "../../../src/report/html.js";

describe("HTML report", () => {
  it("renders a stable standalone report snapshot", () => {
    expect(formatHtml(sampleResult())).toMatchSnapshot();
  });

  it("passes html-validate recommended linting", async () => {
    const htmlvalidate = new HtmlValidate({
      extends: ["html-validate:recommended"],
    });

    const report = await htmlvalidate.validateString(
      formatHtml(sampleResult(), "en", [{ label: "JSON report", href: "boardreadyops.report.json" }]),
    );

    expect(
      report.valid,
      report.results
        .flatMap((result) => result.messages)
        .map((message) => `${message.ruleId}: ${message.message}`)
        .join("\n"),
    ).toBe(true);
  });

  it("has no WCAG A/AA axe violations in the static report shell", async () => {
    const window = new Window({ url: "https://example.test/boardreadyops.report.html" });
    window.document.write(
      formatHtml(sampleResult(), "en", [{ label: "JSON report", href: "boardreadyops.report.json" }]),
    );
    const previous = installDomGlobals(window);
    try {
      const axe = (await import("axe-core")).default;
      const result = await axe.run(window.document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa"],
        },
      });

      expect(
        result.violations,
        result.violations.map((violation) => `${violation.id}: ${violation.help}`).join("\n"),
      ).toEqual([]);
    } finally {
      restoreDomGlobals(previous);
      await window.close();
    }
  });

  it("accepts configured HTML report paths and writes the report", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-html-report-"));
    const written = await writeReports(
      sampleResult(),
      root,
      {},
      loadedConfig("build/boardreadyops.report.html"),
      nullStream(),
    );

    expect(written).toMatchObject({ html: path.join(root, "build/boardreadyops.report.html") });
    const html = await fs.readFile(path.join(root, "build/boardreadyops.report.html"), "utf8");
    expect(html).toContain('id="severity-filter"');
    expect(html).toContain('data-rule="bom.missing-mpn"');
    expect(html).toContain('data-project="assembly/main.kicad_pro"');
  });

  it("validates report.html in the config schema", () => {
    expect(validateConfig({ version: 1, report: { html: "build/boardreadyops.report.html" } })).toEqual([]);
    expect(validateConfig({ version: 1, report: { html: false } })).toEqual([]);
  });

  it("renders the release decision banner near the top with status and summary", () => {
    const html = formatHtml(sampleResult());
    const decisionIndex = html.indexOf('id="decision-heading"');
    const summaryIndex = html.indexOf('id="summary-heading"');

    expect(decisionIndex).toBeGreaterThan(-1);
    expect(decisionIndex).toBeLessThan(summaryIndex);
    expect(html).toContain("Release Decision");
    expect(html).toContain('class="badge decision-badge-fail"');
    expect(html).toContain("Fail");
    expect(html).toContain("3 findings — 1 critical, 1 high.");
  });

  it("renders a passing decision banner when nothing failed", () => {
    const html = formatHtml(sampleResult([], []));
    expect(html).toContain('class="badge decision-badge-pass"');
    expect(html).toContain("Pass");
  });

  it("renders a policy badge in the decision banner when a policy was evaluated", () => {
    const result = sampleResult();
    result.policy = {
      status: "fail",
      enforced: true,
      rules: [{ id: "no-high", type: "max-severity", status: "fail", message: "1 finding at or above high." }],
    };
    const html = formatHtml(result);
    expect(html).toContain("Policy: fail");
  });

  it("renders a passing policy badge in the decision banner", () => {
    const result = sampleResult([], []);
    result.policy = { status: "pass", enforced: false, rules: [] };
    const html = formatHtml(result);
    expect(html).toContain("Policy: pass");
    expect(html).toContain('class="badge decision-badge-pass"');
  });

  it("renders an artifacts section with links when artifacts are provided", () => {
    const html = formatHtml(sampleResult(), "en", [
      { label: "JSON report", href: "boardreadyops.report.json" },
      { label: "SARIF report", href: "boardreadyops.sarif" },
    ]);

    expect(html).toContain('id="artifacts-heading"');
    expect(html).toContain('<a href="boardreadyops.report.json">JSON report</a>');
    expect(html).toContain('<a href="boardreadyops.sarif">SARIF report</a>');
  });

  it("omits the artifacts section when no artifacts are provided", () => {
    expect(formatHtml(sampleResult())).not.toContain('id="artifacts-heading"');
  });

  it("renders the release readiness section with score, status, and evidence", () => {
    const html = formatHtml(sampleResult());

    expect(html).toContain('id="readiness-heading"');
    expect(html).toContain("Release Readiness");
    expect(html).toContain("47/100");
    expect(html).toContain('class="badge readiness-blocked"');
    expect(html).toContain("Profile: JLCPCB (jlcpcb)");
    expect(html).toContain("1 blocking, 1 non-blocking findings");
    expect(html).toContain("Evidence checklist");
    expect(html).toContain("Required output drill is missing.");
  });

  it("omits the readiness section when the result has no readiness score", () => {
    const result = sampleResult();
    delete result.readiness;
    const html = formatHtml(result);

    expect(html).not.toContain('id="readiness-heading"');
    expect(html).not.toContain("Release Readiness");
  });

  it("renders readiness without a profile, evidence, or warnings", () => {
    const result = sampleResult([], []);
    result.readiness = {
      score: 100,
      status: "ready",
      blocking: 0,
      nonBlocking: 0,
      evidence: [],
      missingRequired: [],
      missingRecommended: [],
      warnings: [],
    };
    const html = formatHtml(result);

    expect(html).toContain("Release Readiness");
    expect(html).toContain('class="badge readiness-ready"');
    expect(html).toContain("No vendor profile configured.");
    expect(html).not.toContain("Evidence checklist");
    expect(html).not.toContain("Warnings");
  });

  it("renders a waivers section listing active and expired waivers", () => {
    const result = sampleResult();
    result.waivers = {
      active: [
        {
          rule: "bom.missing-mpn",
          owner: "alice",
          reason: "accepted risk",
          expires: "2026-12-31",
          expired: false,
          stale: false,
          matched: 1,
        },
      ],
      expired: [
        {
          rule: "design.clearance",
          owner: "bob",
          reason: "temporary",
          expires: "2026-01-01",
          expired: true,
          stale: false,
          matched: 2,
        },
      ],
    };
    const html = formatHtml(result);

    expect(html).toContain('id="waivers-heading"');
    expect(html).toContain("Waivers");
    expect(html).toContain("alice");
    expect(html).toContain("accepted risk");
    expect(html).toContain(">expired<");
    expect(html).toContain(">active<");
  });

  it("omits the waivers section when there are no waivers", () => {
    expect(formatHtml(sampleResult())).not.toContain('id="waivers-heading"');
  });

  it("renders empty report sections without filter rows", () => {
    const html = formatHtml(sampleResult([], []));

    expect(html).toContain("No projects were reported.");
    expect(html).toContain("No rules produced findings.");
    expect(html).toContain("No findings.");
    expect(html).toContain("0 findings");
  });

  it("renders pseudo-locale HTML labels for hard-coded string smoke coverage", () => {
    const html = formatHtml(sampleResult([], []), "__PSEUDO__");

    expect(html).toContain("[[BoardReadyOps Report]]");
    expect(html).toContain("[[Summary by Severity]]");
    expect(html).toContain("[[No findings.]]");
  });

  it("renders advanced finding detail branches", () => {
    const html = formatHtml(
      sampleResult([
        createFinding({
          ruleId: "design.board-outline",
          severity: "critical",
          message: "Board outline has a gap.",
          project: "hardware/main.kicad_pro",
          resource: { path: "hardware/main.kicad_pcb", kind: "pcb" },
          location: {
            region: {
              startLine: 42,
              endLine: 44,
            },
            boardCoordinates: {
              x: -0,
              y: 14,
              units: "in",
            },
          },
          confidence: "definite",
          fix: { description: "Close the outline before release." },
          references: ["https://example.test/outline"],
        }),
      ]),
    );

    expect(html).toContain("lines 42-44, board (0in, 14in)");
    expect(html).toContain("Confidence: definite");
    expect(html).toContain("Close the outline before release.");
    expect(html).not.toContain("<ol>");
  });

  it("renders details without optional confidence", () => {
    const html = formatHtml(
      sampleResult([
        createFinding({
          ruleId: "design.copper-balance",
          severity: "low",
          message: "Copper balance is low near the board origin.",
          resource: { path: "hardware/main.kicad_pcb", kind: "pcb" },
          location: {
            boardCoordinates: {
              x: 1.234567,
              y: 2.5,
              layer: "F.Cu",
              units: "mm",
            },
          },
          details: { note: "Needs review" },
        }),
      ]),
    );

    expect(html).toContain("F.Cu (1.234567mm, 2.5mm)");
    expect(html).toContain("&quot;note&quot;: &quot;Needs review&quot;");
    expect(html).not.toContain("Confidence:");
  });

  it("renders the fabrication diff section between decision and readiness when a diff is provided", () => {
    const html = formatHtml(sampleResult(), "en", [], sampleFabricationDiff());

    const decisionIndex = html.indexOf('id="decision-heading"');
    const diffIndex = html.indexOf('id="fabrication-diff-heading"');
    const readinessIndex = html.indexOf('id="readiness-heading"');

    expect(diffIndex).toBeGreaterThan(decisionIndex);
    expect(diffIndex).toBeLessThan(readinessIndex);
    expect(html).toContain("Fabrication Changes");
    // BOM diff rows with localized, color-coded status badges.
    expect(html).toContain('<span class="badge diff-changed">Changed</span>');
    expect(html).toContain('<span class="badge diff-added">Added</span>');
    expect(html).toContain('<span class="badge diff-removed">Removed</span>');
    expect(html).toContain("<code>R1</code>");
    // Manufacturing output diff with a per-output change summary.
    expect(html).toContain("<code>gerber</code>");
    expect(html).toContain("2 changed, 1 added");
    // New findings introduced by the candidate release.
    expect(html).toContain("New Findings");
    expect(html).toContain("R7 is missing an MPN.");
  });

  it("renders an empty BOM note when the diff has no BOM rows", () => {
    const diff = sampleFabricationDiff();
    diff.bom = { rows: [], truncated: false, addedCount: 0, removedCount: 0, changedCount: 0 };
    const html = formatHtml(sampleResult(), "en", [], diff);

    expect(html).toContain("Fabrication Changes");
    expect(html).toContain("No BOM changes recorded.");
  });

  it("renders an empty BOM note when every row is unchanged, not a table of unchanged parts", () => {
    const diff = sampleFabricationDiff();
    diff.bom = {
      rows: [{ reference: "U1", previous: "ATmega328P", current: "ATmega328P", status: "unchanged" }],
      truncated: false,
      addedCount: 0,
      removedCount: 0,
      changedCount: 0,
    };
    const html = formatHtml(sampleResult(), "en", [], diff);

    expect(html).toContain("No BOM changes recorded.");
    expect(html).not.toContain("<code>U1</code>");
  });

  it("omits the fabrication diff section when no diff is provided", () => {
    expect(formatHtml(sampleResult())).not.toContain('id="fabrication-diff-heading"');
  });

  it("passes html-validate recommended linting with a fabrication diff", async () => {
    const htmlvalidate = new HtmlValidate({ extends: ["html-validate:recommended"] });
    const report = await htmlvalidate.validateString(formatHtml(sampleResult(), "en", [], sampleFabricationDiff()));

    expect(
      report.valid,
      report.results
        .flatMap((result) => result.messages)
        .map((message) => `${message.ruleId}: ${message.message}`)
        .join("\n"),
    ).toBe(true);
  });

  it("has no WCAG A/AA axe violations with a fabrication diff rendered", async () => {
    const window = new Window({ url: "https://example.test/boardreadyops.report.html" });
    window.document.write(formatHtml(sampleResult(), "en", [], sampleFabricationDiff()));
    const previous = installDomGlobals(window);
    try {
      const axe = (await import("axe-core")).default;
      const result = await axe.run(window.document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
      });

      expect(
        result.violations,
        result.violations.map((violation) => `${violation.id}: ${violation.help}`).join("\n"),
      ).toEqual([]);
    } finally {
      restoreDomGlobals(previous);
      await window.close();
    }
  });
});

function loadedConfig(html: string): LoadedConfig {
  return {
    config: { version: 1, report: { html } },
    errors: [],
  };
}

function sampleResult(
  findings = [
    createFinding({
      ruleId: "bom.missing-mpn",
      severity: "high",
      message: "R1 is missing an MPN.",
      project: "assembly/main.kicad_pro",
      resource: { path: "bom.csv", kind: "bom" },
      location: { line: 2, column: 1 },
      details: { reference: "R1" },
      references: ["https://github.com/oaslananka/boardreadyops/blob/main/docs/rules/bom.md"],
      fix: {
        description: "Add manufacturer part numbers.",
        steps: ["Populate the MPN column.", "Re-run the BOM check."],
        references: ["https://example.test/mpn"],
        automated: false,
      },
      confidence: "high",
    }),
    createFinding({
      ruleId: "manufacturing.outputs-present",
      severity: "critical",
      message: "Gerber outputs are missing.",
      project: "fabrication/prototype.kicad_pro",
      resource: { path: "fabrication/", kind: "manifest" },
      fix: {
        description: "Generate fabrication outputs before release.",
        steps: ["Open KiCad Plot.", "Export Gerbers and drill files."],
      },
    }),
    createFinding({
      ruleId: "info.note",
      severity: "info",
      message: "Lifecycle source was unavailable.",
      resource: { path: "bom.csv", kind: "bom" },
    }),
  ],
  projects = [
    {
      projectFile: "assembly/main.kicad_pro",
      root: "assembly",
      schematicFiles: ["main.kicad_sch"],
      boardFiles: ["main.kicad_pcb"],
      jobsetFiles: [],
    },
    {
      projectFile: "fabrication/prototype.kicad_pro",
      root: "fabrication",
      schematicFiles: ["prototype.kicad_sch"],
      boardFiles: ["prototype.kicad_pcb"],
      jobsetFiles: [],
    },
  ],
): RunResult {
  return {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: "1.0.2" },
    summary: summarizeFindings(findings, "high"),
    readiness: {
      profile: { id: "jlcpcb", name: "JLCPCB", service: "fabrication+assembly" },
      score: 47,
      status: "blocked",
      blocking: 1,
      nonBlocking: 1,
      evidence: [
        { output: "bom", importance: "required", present: true },
        { output: "drill", importance: "required", present: false },
        { output: "gerber", importance: "required", present: false },
        { output: "pdf", importance: "recommended", present: false },
        { output: "position", importance: "required", present: true },
      ],
      missingRequired: ["drill", "gerber"],
      missingRecommended: ["pdf"],
      warnings: ["Required output drill is missing.", "1 blocking finding(s) must be resolved before release."],
    },
    projects,
    findings,
    fabrication: { bom: [], outputs: [] },
    generatedAt: "2026-05-22T00:00:00.000Z",
  };
}

function sampleFabricationDiff(): FabricationDiff {
  return {
    bom: {
      rows: [
        { reference: "R1", previous: "10k 0402", current: "4.7k 0402", status: "changed" },
        { reference: "C5", previous: "", current: "100nF 0402", status: "added" },
        { reference: "D2", previous: "LED red", current: "", status: "removed" },
        { reference: "U1", previous: "ATmega328P", current: "ATmega328P", status: "unchanged" },
      ],
      truncated: false,
      addedCount: 1,
      removedCount: 1,
      changedCount: 1,
    },
    outputs: [
      { kind: "gerber", status: "changed", changed: 2, added: 1, removed: 0 },
      { kind: "drill", status: "added", changed: 0, added: 0, removed: 0 },
    ],
    findings: {
      added: [
        createFinding({
          ruleId: "bom.missing-mpn",
          severity: "high",
          message: "R7 is missing an MPN.",
          resource: { path: "bom.csv", kind: "bom" },
        }),
      ],
      removed: [],
      unchanged: [],
    },
  };
}

const domGlobalKeys = ["window", "document", "Node", "Element", "Document", "HTMLElement", "SVGElement"] as const;
type DomGlobalKey = (typeof domGlobalKeys)[number];
type DomGlobalSnapshot = Record<DomGlobalKey, unknown>;

function installDomGlobals(window: Window): DomGlobalSnapshot {
  const globalObject = globalThis as unknown as Record<string, unknown>;
  const previous = Object.fromEntries(domGlobalKeys.map((key) => [key, globalObject[key]])) as DomGlobalSnapshot;
  Object.assign(globalObject, {
    window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    Document: window.Document,
    HTMLElement: window.HTMLElement,
    SVGElement: window.SVGElement,
  });
  return previous;
}

function restoreDomGlobals(previous: DomGlobalSnapshot): void {
  const globalObject = globalThis as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      Reflect.deleteProperty(globalObject, key);
    } else {
      Reflect.set(globalObject, key, value);
    }
  }
}

function nullStream(): NodeJS.WritableStream {
  return {
    write() {
      return true;
    },
  } as unknown as NodeJS.WritableStream;
}
