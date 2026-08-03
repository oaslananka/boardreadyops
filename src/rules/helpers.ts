import path from "node:path";
import { isRuleEnabled, ruleConfig, ruleSeverity } from "../core/config.js";
import type { RuleContext } from "../core/context.js";
import {
  type ConfidenceLevel,
  createFinding,
  type Finding,
  type FixSuggestion,
  type Severity,
} from "../core/findings.js";
import type { Rule, RuleMetadata } from "../core/rule-registry.js";
import { normalizeRelative } from "../util/path.js";

export function rule(meta: RuleMetadata, run: Rule["run"]): Rule {
  return { meta, run };
}

function enabled(context: RuleContext, id: string): boolean {
  return isRuleEnabled(context.config, id) && !context.options.skips.includes(id);
}

export function filtered(context: RuleContext, id: string): boolean {
  return context.options.rules.length === 0 || context.options.rules.includes(id);
}

export function shouldRun(context: RuleContext, id: string): boolean {
  return enabled(context, id) && filtered(context, id);
}

export function configuredSeverity(context: RuleContext, id: string, fallback: Severity): Severity {
  return ruleSeverity(context.config, id, fallback);
}

export function configFor(context: RuleContext, id: string): Record<string, unknown> {
  return ruleConfig(context.config, id);
}

export function finding(
  context: RuleContext,
  input: {
    ruleId: string;
    severity: Severity;
    message: string;
    path: string;
    kind: Finding["resource"]["kind"];
    line?: number | undefined;
    column?: number | undefined;
    details?: Record<string, unknown> | undefined;
    fix?: FixSuggestion | undefined;
    confidence?: ConfidenceLevel | undefined;
  },
): Finding {
  const absolute = path.isAbsolute(input.path) ? input.path : path.resolve(context.root, input.path);
  const location = input.line || input.column ? { line: input.line, column: input.column } : undefined;
  const reference = `https://github.com/oaslananka/boardreadyops/blob/main/docs/rules/${input.ruleId.split(".")[0]}.md`;
  const base = {
    ruleId: input.ruleId,
    severity: input.severity,
    message: input.message,
    project: context.projects[0]?.projectFile,
    resource: {
      path: normalizeRelative(context.root, absolute),
      kind: input.kind,
    },
    references: [reference],
    fix: input.fix ?? defaultFix(input.ruleId, reference),
    confidence: input.confidence ?? "high",
  };
  return createFinding({
    ...base,
    ...(location ? { location } : {}),
    ...(input.details ? { details: input.details } : {}),
  });
}

function defaultFix(ruleId: string, reference: string): FixSuggestion {
  return {
    description: `Resolve the ${ruleId} finding before fabrication.`,
    steps: ["Review the affected file and rule guidance.", "Update the project evidence.", "Run BoardReadyOps again."],
    references: [reference],
    automated: false,
  };
}

export function refIgnored(reference: string, patterns: unknown): boolean {
  if (!Array.isArray(patterns)) {
    return false;
  }
  return patterns.some((pattern) => typeof pattern === "string" && globLike(pattern, reference));
}

export function globLike(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}
