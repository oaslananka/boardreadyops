"use client";

import { useState } from "react";
import { cn } from "../../lib/utils.js";
import { AlertDescription, AlertRoot, AlertTitle } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { buttonVariants } from "../ui/button.js";

const CHECK_TONE = {
  pass: "success",
  warn: "warning",
  fail: "danger",
} as const;

export interface PreFlightCheckResult {
  id: string;
  label: string;
  category: "format" | "stackup" | "drill" | "bom" | "dfm";
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface PreFlightSummary {
  format: string;
  layers: number;
  widthMm?: number | undefined;
  heightMm?: number | undefined;
  componentCount: number;
  drillCount: number;
  checks: PreFlightCheckResult[];
  eqRequired: boolean;
  eqItems: string[];
}

export interface ManufacturerIntakeWidgetProps {
  partnerSlug: string;
  partnerName: string;
}

export function ManufacturerIntakeWidget({ partnerSlug, partnerName }: Readonly<ManufacturerIntakeWidgetProps>) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [summary, setSummary] = useState<PreFlightSummary | null>(null);

  function handleSimulatedUpload(selectedName: string) {
    setFileName(selectedName);
    setAnalyzing(true);
    setSummary(null);

    setTimeout(() => {
      setAnalyzing(false);
      // Determine simulation scenario based on filename
      const isAltium = selectedName.toLowerCase().includes("altium") || selectedName.toLowerCase().endsWith(".zip");
      const isIpc = selectedName.toLowerCase().includes("ipc") || selectedName.toLowerCase().endsWith(".xml");
      const isMissingDrill =
        selectedName.toLowerCase().includes("missing-drill") || selectedName.toLowerCase().includes("error");

      const checks: PreFlightCheckResult[] = [
        {
          id: "fmt-1",
          label: "CAD Package Format Detection",
          category: "format",
          status: "pass",
          message: isIpc
            ? "Valid IPC-2581 Rev B XML package with native stackup and netlist."
            : isAltium
              ? "Altium Designer RS-274X Gerbers and Excellon drill package detected."
              : "Generic Gerber package identified.",
        },
        {
          id: "stk-1",
          label: "Copper Layer & Board Outline",
          category: "stackup",
          status: "pass",
          message: "Top and bottom copper layers with closed rectangular board outline (50.0 x 40.0 mm).",
        },
        {
          id: "drl-1",
          label: "Drill Files & Hole Aspect Ratio",
          category: "drill",
          status: isMissingDrill ? "fail" : "pass",
          message: isMissingDrill
            ? "CRITICAL: No plated drill file (Excellon .TXT/.DRL) found in package."
            : "Plated through-holes present; minimum drill 0.3mm within standard fab capability.",
        },
        {
          id: "bom-1",
          label: "BOM Procurement & MPN Validation",
          category: "bom",
          status: "pass",
          message: "12 components mapped; all populated parts carry valid manufacturer part numbers (MPNs).",
        },
        {
          id: "dfm-1",
          label: "Pre-Flight DFM DRC Screening",
          category: "dfm",
          status: isMissingDrill ? "warn" : "pass",
          message: isMissingDrill
            ? "Drill layer verification skipped due to missing drill file."
            : "Clearance >= 0.127mm (5 mil) and annular rings >= 0.15mm pass quick-turn fabrication rules.",
        },
      ];

      const eqItems: string[] = [];
      if (isMissingDrill) {
        eqItems.push("Missing NC drill file (.TXT or .DRL). Re-export drill files from your CAD tool.");
      }

      setSummary({
        format: isIpc ? "IPC-2581 Rev B" : isAltium ? "Altium Designer" : "KiCad / Gerber",
        layers: 4,
        widthMm: 50.0,
        heightMm: 40.0,
        componentCount: 12,
        drillCount: isMissingDrill ? 0 : 48,
        checks,
        eqRequired: eqItems.length > 0,
        eqItems,
      });
    }, 600);
  }

  return (
    <section
      className="rounded-lg border border-border bg-card text-card-foreground shadow-e2"
      data-testid="manufacturer-intake-widget"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <h2 className="text-heading font-semibold text-foreground">Pre-Flight Intake &amp; Verification</h2>
          <p className="mt-1 text-body text-muted-foreground">
            Submit manufacturing packages directly to <strong className="text-foreground">{partnerName}</strong>.
            Automatic pre-flight checks spot defects before order intake.
          </p>
        </div>
        <Badge variant="outline">{partnerSlug.toUpperCase()}</Badge>
      </div>

      <div className="space-y-6 p-6">
        <AlertRoot variant="info">
          <AlertTitle>Demo preview</AlertTitle>
          <AlertDescription>
            Nothing is uploaded and no analysis is performed. The results below are a fixed illustration of what a
            pre-flight report contains.
          </AlertDescription>
        </AlertRoot>

        <div
          data-testid="intake-dropzone"
          className="rounded-lg border-2 border-dashed border-border bg-muted px-6 py-8 text-center"
        >
          <p className="text-base font-semibold text-foreground">
            {fileName ? `Selected: ${fileName}` : "Drop your CAD manufacturing package here or select a test package"}
          </p>
          <p className="mx-auto mt-2 max-w-prose text-meta text-muted-foreground">
            Accepts ZIP archives (Altium, KiCad, EasyEDA, Fusion 360, Gerbers) or IPC-2581 single-file XML (.xml, .cvg).
            Max 50 MB.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              className={buttonVariants({ size: "sm" })}
              onClick={() => handleSimulatedUpload("Altium_STM32_Controller_rev1.zip")}
            >
              Test Clean Package
            </button>
            <button
              type="button"
              className={buttonVariants({ variant: "outline", size: "sm" })}
              onClick={() => handleSimulatedUpload("Client_Board_missing-drill.zip")}
            >
              Test Package With Missing Drill (EQ)
            </button>
          </div>
        </div>

        {analyzing && (
          <output data-testid="intake-analyzing" className="block py-6 text-center">
            <p className="font-semibold text-foreground">Running automated pre-flight checks...</p>
            <p className="mt-1 text-meta text-muted-foreground">
              Verifying format, stackup contours, drill coordinates, and BOM readiness
            </p>
          </output>
        )}

        {summary && (
          <div data-testid="intake-summary" className="space-y-6">
            <div
              className={cn(
                "flex flex-wrap items-center justify-between gap-4 rounded-md border px-4 py-3",
                summary.eqRequired ? "border-danger/40 bg-danger-surface" : "border-success/40 bg-success-surface",
              )}
            >
              <div>
                <Badge variant={summary.eqRequired ? "danger" : "success"} data-testid="intake-status-badge">
                  {summary.eqRequired ? "ENGINEERING QUERY (EQ) REQUIRED" : "PRE-FLIGHT PASSED — READY FOR FAB"}
                </Badge>
                <p className="mt-2 text-body text-foreground">
                  {summary.eqRequired
                    ? `Pre-flight triage detected ${summary.eqItems.length} issue(s) that require resolution before fabrication.`
                    : `Package verified successfully for quick-turn fabrication at ${partnerName}.`}
                </p>
              </div>
              <div className="text-right">
                <span className="text-meta text-muted-foreground">Format</span>
                <div className="font-semibold text-foreground">{summary.format}</div>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Layer Count", value: String(summary.layers) },
                { label: "Dimensions", value: `${summary.widthMm} x ${summary.heightMm} mm` },
                { label: "Components", value: String(summary.componentCount) },
                { label: "Drill Holes", value: String(summary.drillCount) },
              ].map((metric) => (
                <div key={metric.label} className="rounded-md border border-border bg-muted px-3 py-2.5 text-center">
                  <dt className="text-meta text-muted-foreground">{metric.label}</dt>
                  <dd className="text-title font-bold tabular-nums text-foreground">{metric.value}</dd>
                </div>
              ))}
            </dl>

            <div>
              <h3 className="mb-2 text-body font-semibold text-foreground">Automated Pre-Flight Checklist</h3>
              <ul className="divide-y divide-border rounded-md border border-border">
                {summary.checks.map((chk) => (
                  <li key={chk.id} className="flex items-start gap-3 px-3 py-3" data-testid={`check-item-${chk.id}`}>
                    <Badge variant={CHECK_TONE[chk.status]}>{chk.status.toUpperCase()}</Badge>
                    <div>
                      <div className="text-body font-semibold text-foreground">{chk.label}</div>
                      <div className="mt-0.5 text-meta text-muted-foreground">{chk.message}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {summary.eqRequired && (
              <div
                data-testid="eq-action-box"
                className="rounded-md border border-border border-l-4 border-l-danger bg-muted px-4 py-3"
              >
                <h4 className="mb-2 text-body font-semibold text-foreground">
                  Engineering Query (EQ) Items to Resolve:
                </h4>
                <ul className="list-disc space-y-1 pl-5 text-body text-muted-foreground">
                  {summary.eqItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
