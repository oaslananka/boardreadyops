import path from "node:path";
import type { RuleContext } from "../core/context.js";
import type { Finding, Severity } from "../core/findings.js";
import { detectKicadCli, runKicadReport } from "../kicad/cli.js";
import { kicadSeverityToFindingSeverity } from "./drc/severity-map.js";
import { configuredSeverity, finding } from "./helpers.js";

export interface KicadReportRuleOptions {
  command: "drc" | "erc";
  groupRuleId: string;
  unavailableRuleId: string;
  unavailableMessage: string;
  resourceKind: Finding["resource"]["kind"];
  files(project: RuleContext["projects"][number]): string[];
  severity(context: RuleContext, kicadRule: string | undefined, fallback: Severity): Severity;
}

export async function runKicadReportRule(context: RuleContext, options: KicadReportRuleOptions): Promise<Finding[]> {
  const cli = await detectKicadCli(context.options.kicadCli, context.options.signal);
  if (!cli.found || !cli.path) {
    return [
      finding(context, {
        ruleId: options.unavailableRuleId,
        severity: context.options.requireKicad ? "high" : "info",
        message: options.unavailableMessage,
        path: ".",
        kind: "manifest",
      }),
    ];
  }
  const output: Finding[] = [];
  for (const project of context.projects) {
    for (const designFile of options.files(project)) {
      const absoluteFile = path.resolve(context.root, designFile);
      output.push(...(await processDesignFileReport(context, cli.path, cli.version, options, absoluteFile)));
    }
  }
  return output;
}

async function processDesignFileReport(
  context: RuleContext,
  cliPath: string,
  cliVersion: string | undefined,
  options: KicadReportRuleOptions,
  absoluteFile: string,
): Promise<Finding[]> {
  const output: Finding[] = [];
  const result = await runKicadReport(cliPath, options.command, absoluteFile, {
    ...(context.options.variant ? { variant: context.options.variant } : {}),
    ...(cliVersion ? { version: cliVersion } : {}),
    ...(context.options.signal ? { signal: context.options.signal } : {}),
  });
  for (const diagnostic of result.diagnostics) {
    const severity = options.severity(context, diagnostic.ruleId, kicadSeverityToFindingSeverity(diagnostic.severity));
    output.push(
      finding(context, {
        ruleId: `${options.command}.${diagnostic.ruleId ?? "violation"}`,
        severity,
        message: diagnostic.message,
        path: diagnostic.file ?? absoluteFile,
        kind: options.resourceKind,
        line: diagnostic.line,
        column: diagnostic.column,
        details: diagnostic.raw,
      }),
    );
  }
  if (result.status === "failed" && result.diagnostics.length === 0 && result.error) {
    output.push(
      finding(context, {
        ruleId: options.groupRuleId,
        severity: configuredSeverity(context, options.groupRuleId, "high"),
        message: result.error,
        path: absoluteFile,
        kind: options.resourceKind,
      }),
    );
  }
  return output;
}
