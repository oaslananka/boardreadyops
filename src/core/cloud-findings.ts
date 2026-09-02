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

// --- GitHub Check Run annotations -------------------------------------------
//
// Shape-compatible with GitHubCheckRunAnnotation in packages/cloud-core/src/lifecycle-executor.ts,
// duplicated here (structurally, not by import) rather than imported: src/core must never depend on
// @boardreadyops/cloud-core (see docs/architecture/contract-versioning.md's isolation boundary).
// TypeScript's structural typing means a value built to this shape is assignable wherever
// GitHubCheckRunAnnotation is expected on the cloud side, without a nominal type dependency.
export type CheckRunAnnotation = {
  path: string;
  startLine: number;
  endLine: number;
  annotationLevel: "notice" | "warning" | "failure";
  message: string;
  startColumn?: number | undefined;
  endColumn?: number | undefined;
  title?: string | undefined;
};

function annotationLevelForSeverity(severity: Finding["severity"]): CheckRunAnnotation["annotationLevel"] {
  switch (severity) {
    case "critical":
    case "high":
      return "failure";
    case "medium":
      return "warning";
    case "low":
    case "info":
      return "notice";
  }
}

/**
 * Convert a finding into a GitHub Check Run annotation, or undefined if the finding has no line
 * location -- GitHub annotations require a file path and a line range to attach to in the diff
 * view, and Finding.location is optional (not every rule can point at a specific line).
 */
export function findingToCheckRunAnnotation(finding: Finding): CheckRunAnnotation | undefined {
  const startLine = finding.location?.region?.startLine ?? finding.location?.line;
  if (startLine === undefined) {
    return undefined;
  }
  const endLine = finding.location?.region?.endLine ?? startLine;
  return {
    path: finding.resource.path,
    startLine,
    endLine,
    annotationLevel: annotationLevelForSeverity(finding.severity),
    message: finding.message,
    title: finding.ruleId,
    ...(finding.location?.region?.startColumn !== undefined
      ? { startColumn: finding.location.region.startColumn }
      : {}),
    ...(finding.location?.region?.endColumn !== undefined ? { endColumn: finding.location.region.endColumn } : {}),
  };
}

/** Maps findings to Check Run annotations, silently dropping findings with no line location. */
export function findingsToCheckRunAnnotations(findings: Finding[]): CheckRunAnnotation[] {
  const annotations: CheckRunAnnotation[] = [];
  for (const finding of findings) {
    const annotation = findingToCheckRunAnnotation(finding);
    if (annotation) {
      annotations.push(annotation);
    }
  }
  return annotations;
}
