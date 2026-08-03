import type { Finding } from "../core/findings.js";

export function formatAnnotation(finding: Finding): string {
  const command = severityToAnnotationCommand(finding.severity);
  const params = [
    `file=${escapeProperty(finding.resource.path)}`,
    finding.location?.line ? `line=${finding.location.line}` : undefined,
    finding.location?.column ? `col=${finding.location.column}` : undefined,
    `title=${escapeProperty(finding.ruleId)}`,
  ].filter(Boolean);
  return `::${command} ${params.join(",")}::${escapeData(finding.message)}`;
}

function severityToAnnotationCommand(severity: string): "error" | "warning" | "notice" {
  if (severity === "critical" || severity === "high") {
    return "error";
  }
  if (severity === "medium" || severity === "low") {
    return "warning";
  }
  return "notice";
}

export function emitAnnotations(findings: Finding[], stream: NodeJS.WritableStream = process.stdout): void {
  for (const finding of findings) {
    stream.write(`${formatAnnotation(finding)}\n`);
  }
}

function escapeData(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function escapeProperty(value: string): string {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}
