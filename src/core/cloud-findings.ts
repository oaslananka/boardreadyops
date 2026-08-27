import type { Finding } from "./findings.js";

export type CloudFinding = {
  ruleId: string;
  severity: "error" | "high" | "medium" | "low" | "info";
  message: string;
  path?: string | undefined;
  project?: string | undefined;
  fingerprint: string;
};

function mapFindingForCloud(finding: Finding): CloudFinding {
  return {
    ruleId: finding.ruleId,
    severity: finding.severity === "critical" ? "error" : finding.severity,
    message: finding.message,
    path: finding.resource.path,
    project: finding.project,
    fingerprint: finding.fingerprint,
  };
}

export function mapFindingsForCloud(findings: Finding[]): CloudFinding[] {
  return findings.map(mapFindingForCloud);
}
