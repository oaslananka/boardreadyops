import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeReports } from "../../../src/cli/output.js";
import type { LoadedConfig } from "../../../src/core/config.js";
import type { Finding } from "../../../src/core/findings.js";
import { createFinding, summarizeFindings } from "../../../src/core/findings.js";
import type { RunResult } from "../../../src/core/result.js";

describe("configured JUnit reports", () => {
  it("writes a JUnit testsuite XML file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-junit-report-"));
    const written = await writeReports(sampleResult(), root, {}, loadedConfig("reports/junit.xml"), nullStream());

    expect(written).toMatchObject({ junit: path.join(root, "reports/junit.xml") });
    const xml = await fs.readFile(path.join(root, "reports/junit.xml"), "utf8");
    expect(isJUnitTestsuiteXml(xml)).toBe(true);
    expect(hasTimestamp(xml)).toBe(true);
  });

  it("counts only non-info findings as JUnit failures", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-junit-report-"));
    const findings = [
      createFinding({
        ruleId: "release.required",
        severity: "critical",
        message: "missing release artifact",
        resource: { path: "dist/", kind: "manifest" },
      }),
      createFinding({
        ruleId: "bom.lifecycle",
        severity: "medium",
        message: "part lifecycle should be reviewed",
        resource: { path: "bom.csv", kind: "bom" },
      }),
      createFinding({
        ruleId: "info.note",
        severity: "info",
        message: "informational finding",
        resource: { path: "board.kicad_pro", kind: "project" },
      }),
    ];

    await writeReports(sampleResult(findings), root, {}, loadedConfig("reports/junit.xml"), nullStream());

    const xml = await fs.readFile(path.join(root, "reports/junit.xml"), "utf8");
    expect(xml).toContain('tests="3"');
    expect(xml).toContain('failures="2"');
    expect(xml.match(/<testcase/g)).toHaveLength(3);
    expect(xml.match(/<failure/g)).toHaveLength(2);
    expect(xml).toContain('classname="info.note"');
  });
});

function loadedConfig(junit: string): LoadedConfig {
  return {
    config: { version: 1, report: { junit } },
    errors: [],
  };
}

function sampleResult(findings: Finding[] = []): RunResult {
  return {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: "1.0.2" },
    summary: summarizeFindings(findings, "high"),
    projects: [],
    findings,
    fabrication: { bom: [], outputs: [] },
    generatedAt: "2026-05-21T00:00:00.000Z",
  };
}

function nullStream(): NodeJS.WritableStream {
  return {
    write() {
      return true;
    },
  } as unknown as NodeJS.WritableStream;
}

function isJUnitTestsuiteXml(xml: string): boolean {
  return (
    xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>') &&
    /<testsuite [^>]*tests="\d+"[^>]*failures="\d+"[^>]*>/.test(xml) &&
    xml.endsWith("</testsuite>\n")
  );
}

function hasTimestamp(xml: string): boolean {
  return /timestamp="[^"]+"/.test(xml);
}
