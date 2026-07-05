import type { Finding } from "../core/findings.js";
import type { RunResult } from "../core/result.js";
import { reportFindingContext } from "./finding-context.js";

export function formatJunit(result: RunResult): string {
  const cases = result.findings
    .map((finding) => {
      const context = reportFindingContext(finding);
      const failure =
        finding.severity === "info"
          ? ""
          : `<failure message="${xml(finding.message)}">${failureBody(finding, context)}</failure>`;
      return `<testcase classname="${xml(finding.ruleId)}" name="${xml(context.location)}" file="${xml(
        finding.resource.path,
      )}" id="${xml(context.stableId)}">${failure}</testcase>`;
    })
    .join("");
  const timestamp = result.generatedAt ? ` timestamp="${xml(result.generatedAt)}"` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><testsuite name="boardreadyops" tests="${result.findings.length}" failures="${result.summary.total - result.summary.info}"${timestamp}>${cases}</testsuite>\n`;
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function failureBody(finding: Finding, context: ReturnType<typeof reportFindingContext>): string {
  const details = finding.details ?? {};
  const payload = {
    ...details,
    fingerprint: context.fingerprint,
    location: context.location,
    help: context.help,
    ...(finding.fix ? { fix: finding.fix } : {}),
  };
  return xml(JSON.stringify(payload));
}
