"use client";

import { useState } from "react";

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

export function ManufacturerIntakeWidget({ partnerSlug, partnerName }: ManufacturerIntakeWidgetProps) {
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
    <div className="panel" data-testid="manufacturer-intake-widget">
      <div className="panel-header">
        <div>
          <h2 style={{ fontSize: "1.25rem", margin: 0 }}>Pre-Flight Intake & Verification</h2>
          <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.875rem" }}>
            Submit manufacturing packages directly to <strong>{partnerName}</strong>. Automatic pre-flight checks spot
            defects before order intake.
          </p>
        </div>
        <span className="badge badge-outline">{partnerSlug.toUpperCase()}</span>
      </div>

      <div style={{ padding: "1.5rem" }}>
        {/* Upload Drop Zone */}
        <div
          data-testid="intake-dropzone"
          style={{
            border: "2px dashed var(--border-default)",
            borderRadius: "8px",
            padding: "2rem",
            textAlign: "center",
            background: "var(--surface-sunken)",
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: "1rem" }}>
            {fileName ? `Selected: ${fileName}` : "Drop your CAD manufacturing package here or select a test package"}
          </p>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            Accepts ZIP archives (Altium, KiCad, EasyEDA, Fusion 360, Gerbers) or IPC-2581 single-file XML (.xml, .cvg).
            Max 50 MB.
          </p>
          <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", justifyContent: "center" }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleSimulatedUpload("Altium_STM32_Controller_rev1.zip")}
            >
              Test Clean Package
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleSimulatedUpload("Client_Board_missing-drill.zip")}
            >
              Test Package With Missing Drill (EQ)
            </button>
          </div>
        </div>

        {analyzing && (
          <div data-testid="intake-analyzing" style={{ textAlign: "center", padding: "2rem 0" }}>
            <p style={{ fontWeight: 600, margin: 0 }}>Running automated pre-flight checks...</p>
            <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", margin: "0.25rem 0 0" }}>
              Verifying format, stackup contours, drill coordinates, and BOM readiness
            </p>
          </div>
        )}

        {summary && (
          <div data-testid="intake-summary" style={{ marginTop: "1.5rem" }}>
            {/* Status Header Banner */}
            <div
              style={{
                padding: "1rem",
                borderRadius: "6px",
                marginBottom: "1.5rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: summary.eqRequired ? "rgba(239, 68, 68, 0.1)" : "rgba(34, 197, 94, 0.1)",
                border: `1px solid ${summary.eqRequired ? "var(--error-border, #ef4444)" : "var(--success-border, #22c55e)"}`,
              }}
            >
              <div>
                <span
                  className={`badge ${summary.eqRequired ? "badge-critical" : "badge-passed"}`}
                  data-testid="intake-status-badge"
                >
                  {summary.eqRequired ? "ENGINEERING QUERY (EQ) REQUIRED" : "PRE-FLIGHT PASSED — READY FOR FAB"}
                </span>
                <p style={{ margin: "0.5rem 0 0", fontSize: "0.875rem" }}>
                  {summary.eqRequired
                    ? `Pre-flight triage detected ${summary.eqItems.length} issue(s) that require resolution before fabrication.`
                    : `Package verified successfully for quick-turn fabrication at ${partnerName}.`}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Format</span>
                <div style={{ fontWeight: 600 }}>{summary.format}</div>
              </div>
            </div>

            {/* Quick Metrics */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "1rem",
                marginBottom: "1.5rem",
              }}
            >
              <div className="panel" style={{ padding: "0.75rem", textAlign: "center" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Layer Count</div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{summary.layers}</div>
              </div>
              <div className="panel" style={{ padding: "0.75rem", textAlign: "center" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Dimensions</div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>
                  {summary.widthMm} x {summary.heightMm} mm
                </div>
              </div>
              <div className="panel" style={{ padding: "0.75rem", textAlign: "center" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Components</div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{summary.componentCount}</div>
              </div>
              <div className="panel" style={{ padding: "0.75rem", textAlign: "center" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Drill Holes</div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{summary.drillCount}</div>
              </div>
            </div>

            {/* Check Results List */}
            <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Automated Pre-Flight Checklist</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {summary.checks.map((chk) => (
                <li
                  key={chk.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.75rem",
                    padding: "0.75rem",
                    borderBottom: "1px solid var(--border-default)",
                  }}
                  data-testid={`check-item-${chk.id}`}
                >
                  <span
                    className={`badge ${
                      chk.status === "pass" ? "badge-passed" : chk.status === "warn" ? "badge-medium" : "badge-critical"
                    }`}
                  >
                    {chk.status.toUpperCase()}
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{chk.label}</div>
                    <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", marginTop: "0.125rem" }}>
                      {chk.message}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* EQ Action Items */}
            {summary.eqRequired && (
              <div
                data-testid="eq-action-box"
                style={{
                  marginTop: "1.5rem",
                  padding: "1rem",
                  background: "var(--surface-sunken)",
                  borderRadius: "6px",
                  borderLeft: "4px solid var(--error-border, #ef4444)",
                }}
              >
                <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.9375rem" }}>
                  Engineering Query (EQ) Items to Resolve:
                </h4>
                <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem" }}>
                  {summary.eqItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
