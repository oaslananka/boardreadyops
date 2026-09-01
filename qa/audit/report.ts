import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type RouteFinding = {
  routeId: string;
  path: string;
  viewport: string;
  rule: string;
  severity: "P0" | "P1" | "P2";
  detail: string;
};

export type AuditSummary = {
  routesDiscovered: number;
  routesCovered: number;
  statesChecked: number;
  findings: RouteFinding[];
};

const outputPath = "qa-audit-report.json";

/** Appends one finding. Tests call this as they run; the summary is written once at the end. */
export class AuditReport {
  private readonly findings: RouteFinding[] = [];
  private readonly routesCovered = new Set<string>();

  constructor(private readonly routesDiscovered: number) {}

  markCovered(routeId: string): void {
    this.routesCovered.add(routeId);
  }

  add(finding: RouteFinding): void {
    this.findings.push(finding);
  }

  summary(): AuditSummary {
    return {
      routesDiscovered: this.routesDiscovered,
      routesCovered: this.routesCovered.size,
      statesChecked: this.routesCovered.size,
      findings: this.findings,
    };
  }

  /** Writes JSON to qa-audit-report.json and returns a human-readable block for stdout. */
  finalize(): string {
    const summary = this.summary();
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(summary, null, 2));
    return formatReport(summary);
  }
}

export function formatReport(summary: AuditSummary): string {
  const p0 = summary.findings.filter((f) => f.severity === "P0");
  const p1 = summary.findings.filter((f) => f.severity === "P1");
  const p2 = summary.findings.filter((f) => f.severity === "P2");

  const lines: string[] = [
    "BoardReadyOps QA Audit",
    "─".repeat(40),
    "",
    `Routes discovered:      ${summary.routesDiscovered}`,
    `Routes covered:         ${summary.routesCovered}`,
    `States checked:         ${summary.statesChecked}`,
    "",
    `P0 findings:            ${p0.length}`,
    `P1 findings:            ${p1.length}`,
    `P2 findings:            ${p2.length}`,
    "",
  ];

  if (summary.findings.length === 0) {
    lines.push("PASS");
    return lines.join("\n");
  }

  lines.push("FINDINGS", "");
  for (const f of [...p0, ...p1, ...p2]) {
    lines.push(`[${f.severity}] ${f.path} (${f.viewport})`, `${f.rule}: ${f.detail}`, "");
  }
  lines.push(p0.length > 0 ? "FAIL" : "PASS (with P1/P2 findings)");
  return lines.join("\n");
}
