"use client";

import { type FormEvent, useState } from "react";

export type ReviewFindingSeverity = "error" | "warning" | "info";

export type ReviewFinding = {
  id: string;
  ruleId: string;
  message: string;
  severity: ReviewFindingSeverity;
  category?: string;
  layer?: string;
  coordinates?: { x: number; y: number };
  correctiveGuidance?: string;
  diffStatus?: "new" | "pre-existing";
  waived?: boolean;
  waiverReason?: string;
};

export type ReviewLayer = {
  name: string;
  fileRole: string;
  color?: string | undefined;
  visible?: boolean | undefined;
};

export type DrillHole = {
  x: number;
  y: number;
  diameter: number;
};

export type TriPaneReviewLayoutProps = Readonly<{
  findings: ReviewFinding[];
  layers?: ReviewLayer[] | undefined;
  drillHoles?: DrillHole[] | undefined;
  selectedFindingId?: string | undefined;
  onSelectFinding?: ((findingId: string) => void) | undefined;
  onWaiveFinding?:
    | ((findingId: string, waiver: { reason: string; author: string; expirationDate?: string | undefined }) => void)
    | undefined;
}>;

type MobilePane = "findings" | "board" | "details";

export function TriPaneReviewLayout({
  findings,
  layers = [],
  drillHoles = [],
  selectedFindingId,
  onSelectFinding,
  onWaiveFinding,
}: TriPaneReviewLayoutProps) {
  const [activeMobilePane, setActiveMobilePane] = useState<MobilePane>("findings");
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(
    selectedFindingId ?? findings[0]?.id ?? null,
  );
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [waiverReason, setWaiverReason] = useState("Accepted design trade-off for current revision");
  const [waiverAuthor, setWaiverAuthor] = useState("Hardware Lead");
  const [waiverExpiry, setWaiverExpiry] = useState("");

  const activeId = selectedFindingId ?? internalSelectedId;
  const selectedFinding = findings.find((f) => f.id === activeId);

  const filteredFindings = findings.filter((f) => {
    if (severityFilter === "all") return true;
    return f.severity === severityFilter;
  });

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;

  function handleSelect(id: string) {
    setInternalSelectedId(id);
    onSelectFinding?.(id);
    setActiveMobilePane("details");
  }

  function handleWaiverSubmit(e: FormEvent) {
    e.preventDefault();
    if (!activeId || !onWaiveFinding) return;
    onWaiveFinding(activeId, {
      reason: waiverReason,
      author: waiverAuthor,
      expirationDate: waiverExpiry || undefined,
    });
  }

  return (
    <div className="tri-pane-review-workspace">
      {/* Mobile navigation tab bar */}
      <div className="tri-pane-mobile-tabs" role="tablist" aria-label="Review workspace views">
        <button
          type="button"
          role="tab"
          className={`mobile-pane-tab ${activeMobilePane === "findings" ? "active" : ""}`}
          aria-selected={activeMobilePane === "findings"}
          onClick={() => setActiveMobilePane("findings")}
        >
          Findings
        </button>
        <button
          type="button"
          role="tab"
          className={`mobile-pane-tab ${activeMobilePane === "board" ? "active" : ""}`}
          aria-selected={activeMobilePane === "board"}
          onClick={() => setActiveMobilePane("board")}
        >
          Board
        </button>
        <button
          type="button"
          role="tab"
          className={`mobile-pane-tab ${activeMobilePane === "details" ? "active" : ""}`}
          aria-selected={activeMobilePane === "details"}
          onClick={() => setActiveMobilePane("details")}
        >
          Details
        </button>
      </div>

      <div className="tri-pane-columns">
        {/* Left Pane: Finding Filters & List */}
        <aside
          className={`tri-pane left-pane ${activeMobilePane === "findings" ? "mobile-active" : ""}`}
          data-pane="findings"
        >
          <div className="pane-header">
            <h3>Findings</h3>
            <div className="finding-counts">
              <span className="badge badge-error">{errorCount} blocking</span>
              <span className="badge badge-warning">{warningCount} warnings</span>
            </div>
          </div>

          <div className="finding-filter-bar">
            <select
              aria-label="Filter findings by severity"
              className="filter-select"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
            >
              <option value="all">All Severities ({findings.length})</option>
              <option value="error">Errors only ({errorCount})</option>
              <option value="warning">Warnings only ({warningCount})</option>
            </select>
          </div>

          <div className="findings-scroll-list">
            {filteredFindings.map((finding) => {
              const isSelected = finding.id === activeId;
              return (
                <button
                  type="button"
                  key={finding.id}
                  className={`finding-card ${isSelected ? "selected" : ""} severity-${finding.severity}`}
                  onClick={() => handleSelect(finding.id)}
                  aria-pressed={isSelected}
                >
                  <div className="finding-card-header">
                    <span className="finding-rule-badge">{finding.ruleId}</span>
                    <span className={`severity-tag severity-${finding.severity}`}>{finding.severity}</span>
                  </div>
                  <p className="finding-card-message">{finding.message}</p>
                  {finding.layer && <span className="finding-layer-hint">Layer: {finding.layer}</span>}
                </button>
              );
            })}
            {filteredFindings.length === 0 && (
              <div className="findings-empty-state">
                <p>No findings matching the selected filter.</p>
              </div>
            )}
          </div>
        </aside>

        {/* Center Pane: Multi-CAD Layer Canvas */}
        <section
          className={`tri-pane center-pane ${activeMobilePane === "board" ? "mobile-active" : ""}`}
          data-pane="board"
        >
          <div className="pane-header">
            <h3>Visual Inspection Canvas</h3>
            <span className="layer-count-hint">
              {layers.length > 0 ? `${layers.length} Layers Loaded` : "Direct Board Inspection"}
            </span>
          </div>

          <div className="board-canvas-wrapper">
            {layers.length === 0 && drillHoles.length === 0 && findings.length === 0 ? (
              <div className="canvas-empty-state">
                <p>No visual layers or coordinates available for this package.</p>
              </div>
            ) : (
              <div className="board-svg-container">
                <svg
                  className="board-svg"
                  viewBox="0 0 100 100"
                  role="img"
                  aria-label="Board layer outline and drill holes"
                >
                  {/* Board boundary outline */}
                  <rect
                    x="5"
                    y="5"
                    width="90"
                    height="90"
                    rx="3"
                    className="board-outline"
                    fill="#121820"
                    stroke="var(--bro-accent, #c69a3e)"
                    strokeWidth="0.75"
                  />
                  {/* Drill holes */}
                  {drillHoles.map((hole) => (
                    <circle
                      key={`hole-${hole.x}-${hole.y}-${hole.diameter}`}
                      cx={hole.x}
                      cy={hole.y}
                      r={Math.max(hole.diameter / 2, 0.8)}
                      className="drill-hole"
                      fill="#080b10"
                      stroke="#4b5563"
                      strokeWidth="0.2"
                    />
                  ))}
                  {/* Finding Markers */}
                  {findings.map((f) => {
                    if (!f.coordinates) return null;
                    const isSelected = f.id === activeId;
                    return (
                      // biome-ignore lint/a11y/useSemanticElements: SVG canvas markers require ARIA button role
                      <g
                        key={`marker-${f.id}`}
                        className={`canvas-finding-marker ${isSelected ? "selected" : ""}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`Finding ${f.ruleId}`}
                        onClick={() => handleSelect(f.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSelect(f.id);
                          }
                        }}
                      >
                        <circle
                          cx={f.coordinates.x}
                          cy={f.coordinates.y}
                          r={isSelected ? 3.5 : 2}
                          fill={f.severity === "error" ? "#ef4444" : "#f59e0b"}
                          opacity="0.85"
                        />
                        {isSelected && (
                          <circle
                            cx={f.coordinates.x}
                            cy={f.coordinates.y}
                            r={5.5}
                            fill="none"
                            stroke="#ffffff"
                            strokeWidth="0.5"
                          />
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
          </div>
        </section>

        {/* Right Pane: Selected Finding Details & Waiver Form */}
        <aside
          className={`tri-pane right-pane ${activeMobilePane === "details" ? "mobile-active" : ""}`}
          data-pane="details"
        >
          <div className="pane-header">
            <h3>Finding Details</h3>
          </div>

          {selectedFinding ? (
            <div className="finding-detail-body">
              <div className="detail-section">
                <span className="rule-title-label">Rule Identifier</span>
                <code className="detail-rule-code">{selectedFinding.ruleId}</code>
                <p className="detail-finding-message">{selectedFinding.message}</p>
              </div>

              <div className="detail-meta-grid">
                <div className="meta-item">
                  <span className="meta-label">Severity</span>
                  <span className={`meta-value severity-${selectedFinding.severity}`}>
                    {selectedFinding.severity.toUpperCase()}
                  </span>
                </div>
                {selectedFinding.layer && (
                  <div className="meta-item">
                    <span className="meta-label">Affected Layer</span>
                    <span className="meta-value">{selectedFinding.layer}</span>
                  </div>
                )}
                {selectedFinding.coordinates && (
                  <div className="meta-item">
                    <span className="meta-label">CAD Coordinates</span>
                    <span className="meta-value">
                      X: {selectedFinding.coordinates.x.toFixed(2)}, Y: {selectedFinding.coordinates.y.toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="meta-item">
                  <span className="meta-label">Revision Delta</span>
                  <span className="meta-value">
                    {selectedFinding.diffStatus === "new" ? "New in this revision" : "Pre-existing in prior revision"}
                  </span>
                </div>
              </div>

              {selectedFinding.correctiveGuidance && (
                <div className="detail-section corrective-guidance-box">
                  <h4>Recommended CAD Action</h4>
                  <p>{selectedFinding.correctiveGuidance}</p>
                </div>
              )}

              <div className="detail-section waiver-section">
                <h4>Sign-Off & Exception Waiver</h4>
                <form className="waiver-form" onSubmit={handleWaiverSubmit}>
                  <div className="form-group">
                    <label htmlFor="waiver-reason-input">Justification Reason</label>
                    <textarea
                      id="waiver-reason-input"
                      className="input-textarea"
                      rows={2}
                      value={waiverReason}
                      onChange={(e) => setWaiverReason(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="waiver-author-input">Signed By</label>
                    <input
                      id="waiver-author-input"
                      type="text"
                      className="input-text"
                      value={waiverAuthor}
                      onChange={(e) => setWaiverAuthor(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="waiver-expiry-input">Expiration Date (Optional)</label>
                    <input
                      id="waiver-expiry-input"
                      type="date"
                      className="input-text"
                      value={waiverExpiry}
                      onChange={(e) => setWaiverExpiry(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="submit-waiver-button button button-secondary">
                    Record Finding Waiver
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <div className="detail-empty-selection">
              <p>Select a finding from the left pane to inspect CAD coordinates and corrective guidance.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
