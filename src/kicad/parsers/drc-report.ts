import { z } from "zod";

const kicadDiagnosticSchema = z
  .object({
    rule: z.string().optional(),
    ruleId: z.string().optional(),
    type: z.string().optional(),
    key: z.string().optional(),
    severity: z.string().optional(),
    message: z.string().optional(),
    description: z.string().optional(),
    file: z.string().optional(),
    path: z.string().optional(),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
  })
  .passthrough();

const kicadReportSchema = z
  .object({
    violations: z.array(kicadDiagnosticSchema).optional(),
    diagnostics: z.array(kicadDiagnosticSchema).optional(),
    errors: z.array(kicadDiagnosticSchema).optional(),
    warnings: z.array(kicadDiagnosticSchema).optional(),
  })
  .passthrough();

export interface KicadDiagnostic {
  ruleId?: string | undefined;
  severity?: string | undefined;
  message: string;
  file?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
  raw: Record<string, unknown>;
}

export function parseKicadDiagnostics(reportText: string, fallbackRule: string): KicadDiagnostic[] {
  if (!reportText.trim()) {
    return [];
  }
  const parsed = JSON.parse(reportText) as unknown;
  const diagnostics: KicadDiagnostic[] = [];
  const report = kicadReportSchema.safeParse(parsed);
  if (report.success) {
    // KiCad 10 declares physical units at report root, not per violation.
    const coordinateUnits =
      parsed && typeof parsed === "object" && "coordinate_units" in parsed
        ? (parsed as { coordinate_units?: unknown }).coordinate_units
        : undefined;
    for (const key of ["violations", "diagnostics", "errors", "warnings"] as const) {
      for (const diagnostic of report.data[key] ?? []) {
        const normalized = normalizeDiagnostic(diagnostic, fallbackRule);
        if (normalized) {
          // Only explicit millimeter metadata qualifies for real PCB object anchors.
          if (coordinateUnits === "mm") normalized.raw.coordinate_units = "mm";
          diagnostics.push(normalized);
        }
      }
    }
    if (diagnostics.length > 0) {
      return diagnostics;
    }
  }
  collect(parsed, diagnostics, fallbackRule);
  return diagnostics;
}

function collect(value: unknown, output: KicadDiagnostic[], fallbackRule: string, depth = 0): void {
  if (depth > 16 || output.length > 1000) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collect(item, output, fallbackRule, depth + 1);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  const row = value as Record<string, unknown>;
  const candidate = kicadDiagnosticSchema.safeParse(row);
  if (candidate.success) {
    const normalized = normalizeDiagnostic(candidate.data, fallbackRule);
    if (normalized) {
      output.push(normalized);
      return;
    }
  }
  for (const nested of Object.values(row)) {
    collect(nested, output, fallbackRule, depth + 1);
  }
}

function normalizeDiagnostic(
  row: z.infer<typeof kicadDiagnosticSchema>,
  fallbackRule: string,
): KicadDiagnostic | undefined {
  const message = row.message ?? row.description;
  if (!message) {
    return undefined;
  }
  return {
    ruleId: row.ruleId ?? row.rule ?? row.type ?? row.key ?? fallbackRule,
    severity: row.severity,
    message,
    file: row.file ?? row.path,
    line: row.line,
    column: row.column,
    raw: row,
  };
}
