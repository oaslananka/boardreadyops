"use client";

import type { FindingDisposition } from "@boardreadyops/contracts";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DemoFinding } from "../../lib/demo-data.js";
import { DecisionModal } from "./decision-modal.js";

export interface FindingsTabProps {
  findings: DemoFinding[];
  onUpdateDisposition?: (fingerprint: string, disposition: FindingDisposition, reason?: string, owner?: string) => void;
  onAssign?: (fingerprint: string, assignee: string) => void;
}

const diffStateOrder = ["all", "new", "persistent", "regressed", "resolved"] as const;

function getSeverityBadgeClass(severity: string): string {
  if (severity === "error" || severity === "critical") {
    return "bg-danger-surface text-danger";
  }
  if (severity === "warning") {
    return "bg-warning-surface text-warning";
  }
  return "bg-info-surface text-info";
}

function getDiffStateBadgeClass(diffState: string): string {
  switch (diffState) {
    case "new":
      return "bg-info-surface text-info";
    case "regressed":
      return "bg-danger-surface text-danger";
    case "resolved":
      return "bg-success-surface text-success";
    default:
      return "bg-secondary text-secondary-foreground";
  }
}

export function FindingsTab({ findings, onUpdateDisposition, onAssign }: Readonly<FindingsTabProps>) {
  const [selectedDiffState, setSelectedDiffState] = useState<string>("all");
  const [selectedSeverity, setSelectedSeverity] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [modalFinding, setModalFinding] = useState<{
    finding: DemoFinding;
    targetDisposition: FindingDisposition;
  } | null>(null);
  const [assigneeDraft, setAssigneeDraft] = useState<Record<string, string>>({});

  function handleDiffStateTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, currentState: string) {
    const currentIndex = diffStateOrder.indexOf(currentState as (typeof diffStateOrder)[number]);
    let nextIndex: number | null = null;
    if (e.key === "ArrowRight") nextIndex = (currentIndex + 1) % diffStateOrder.length;
    else if (e.key === "ArrowLeft") nextIndex = (currentIndex - 1 + diffStateOrder.length) % diffStateOrder.length;
    else if (e.key === "Home") nextIndex = 0;
    else if (e.key === "End") nextIndex = diffStateOrder.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const nextState = diffStateOrder[nextIndex];
    if (!nextState) return;
    setSelectedDiffState(nextState);
    setSelectedIndex(0);
    document.getElementById(`diff-state-tab-${nextState}`)?.focus();
  }

  const filteredFindings = useMemo(() => {
    return findings.filter((f) => {
      if (selectedDiffState !== "all" && f.diffState !== selectedDiffState) return false;
      if (selectedSeverity !== "all" && f.severity !== selectedSeverity) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matches =
          f.ruleId.toLowerCase().includes(q) ||
          f.message.toLowerCase().includes(q) ||
          f.component?.toLowerCase().includes(q) ||
          f.path.toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [findings, selectedDiffState, selectedSeverity, searchQuery]);

  const handleDirectDisposition = useCallback(
    (fingerprint: string, disposition: FindingDisposition) => {
      onUpdateDisposition?.(fingerprint, disposition);
    },
    [onUpdateDisposition],
  );

  const handleAssign = useCallback(
    (fingerprint: string, assignee: string) => {
      const trimmed = assignee.trim();
      if (!trimmed) return;
      setAssigneeDraft((prev) => ({ ...prev, [fingerprint]: "" }));
      onAssign?.(fingerprint, trimmed);
    },
    [onAssign],
  );

  // Keyboard triage shortcuts: J (next), K (prev), E (accept risk), F (false positive), O (open)
  useEffect(() => {
    function handleKeyDown(e: { key: string; preventDefault: () => void }) {
      const doc = (globalThis as { document?: { activeElement?: { tagName?: string } } }).document;
      const activeTag = doc?.activeElement?.tagName;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA" || modalFinding !== null) {
        return;
      }

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, Math.max(0, filteredFindings.length - 1)));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === "e") {
        const current = filteredFindings[selectedIndex];
        if (current) {
          e.preventDefault();
          setModalFinding({ finding: current, targetDisposition: "accepted_risk" });
        }
      } else if (e.key === "f") {
        const current = filteredFindings[selectedIndex];
        if (current) {
          e.preventDefault();
          setModalFinding({ finding: current, targetDisposition: "false_positive" });
        }
      } else if (e.key === "o") {
        const current = filteredFindings[selectedIndex];
        if (current) {
          e.preventDefault();
          handleDirectDisposition(current.fingerprint, "open");
        }
      }
    }

    const win = globalThis as {
      addEventListener?: (type: string, listener: (event: { key: string; preventDefault: () => void }) => void) => void;
      removeEventListener?: (
        type: string,
        listener: (event: { key: string; preventDefault: () => void }) => void,
      ) => void;
    };
    win.addEventListener?.("keydown", handleKeyDown);
    return () => win.removeEventListener?.("keydown", handleKeyDown);
  }, [filteredFindings, selectedIndex, modalFinding, handleDirectDisposition]);

  function handleModalConfirm(data: { reason: string; owner: string; expiresAt?: string }) {
    if (!modalFinding) return;
    const { finding, targetDisposition } = modalFinding;
    onUpdateDisposition?.(finding.fingerprint, targetDisposition, data.reason, data.owner);
    setModalFinding(null);
  }

  const counts = useMemo(() => {
    return {
      all: findings.length,
      new: findings.filter((f) => f.diffState === "new").length,
      persistent: findings.filter((f) => f.diffState === "persistent").length,
      regressed: findings.filter((f) => f.diffState === "regressed").length,
      resolved: findings.filter((f) => f.diffState === "resolved").length,
    };
  }, [findings]);

  return (
    <div className="flex flex-col gap-4">
      {/* `findings-triage-toolbar` carries no styling any more (its styles.css rule is gone) --
          it is kept as a stable selector hook for tests/unit/web/keyboard-triage.test.ts. */}
      <div className="findings-triage-toolbar flex flex-col gap-3 rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter findings by diff state">
          <button
            id="diff-state-tab-all"
            type="button"
            role="tab"
            aria-selected={selectedDiffState === "all"}
            tabIndex={selectedDiffState === "all" ? 0 : -1}
            className={`rounded-sm px-3 py-1.5 text-sm ${selectedDiffState === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => {
              setSelectedDiffState("all");
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => handleDiffStateTabKeyDown(e, "all")}
          >
            All ({counts.all})
          </button>
          <button
            id="diff-state-tab-new"
            type="button"
            role="tab"
            aria-selected={selectedDiffState === "new"}
            tabIndex={selectedDiffState === "new" ? 0 : -1}
            className={`rounded-sm px-3 py-1.5 text-sm ${selectedDiffState === "new" ? "bg-info-surface text-info" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => {
              setSelectedDiffState("new");
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => handleDiffStateTabKeyDown(e, "new")}
          >
            + New ({counts.new})
          </button>
          <button
            id="diff-state-tab-persistent"
            type="button"
            role="tab"
            aria-selected={selectedDiffState === "persistent"}
            tabIndex={selectedDiffState === "persistent" ? 0 : -1}
            className={`rounded-sm px-3 py-1.5 text-sm ${selectedDiffState === "persistent" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => {
              setSelectedDiffState("persistent");
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => handleDiffStateTabKeyDown(e, "persistent")}
          >
            Persistent ({counts.persistent})
          </button>
          <button
            id="diff-state-tab-regressed"
            type="button"
            role="tab"
            aria-selected={selectedDiffState === "regressed"}
            tabIndex={selectedDiffState === "regressed" ? 0 : -1}
            className={`rounded-sm px-3 py-1.5 text-sm ${selectedDiffState === "regressed" ? "bg-danger-surface text-danger" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => {
              setSelectedDiffState("regressed");
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => handleDiffStateTabKeyDown(e, "regressed")}
          >
            ⚠ Regressed ({counts.regressed})
          </button>
          <button
            id="diff-state-tab-resolved"
            type="button"
            role="tab"
            aria-selected={selectedDiffState === "resolved"}
            tabIndex={selectedDiffState === "resolved" ? 0 : -1}
            className={`rounded-sm px-3 py-1.5 text-sm ${selectedDiffState === "resolved" ? "bg-success-surface text-success" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => {
              setSelectedDiffState("resolved");
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => handleDiffStateTabKeyDown(e, "resolved")}
          >
            ✓ Resolved ({counts.resolved})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Search findings"
            placeholder="Search rule, component, message..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.currentTarget.value);
              setSelectedIndex(0);
            }}
            className="min-w-48 flex-1 rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />

          {/* `triage-severity-select` carries no styling any more -- kept as a stable selector
              hook for tests/unit/web/findings-tab.test.ts. */}
          <select
            aria-label="Filter by severity"
            value={selectedSeverity}
            onChange={(e) => {
              setSelectedSeverity(e.currentTarget.value);
              setSelectedIndex(0);
            }}
            className="triage-severity-select rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>

          <div className="text-xs text-muted-foreground">
            <span>Shortcuts: </span>
            <kbd className="rounded-sm border border-border bg-muted px-1">j</kbd>/
            <kbd className="rounded-sm border border-border bg-muted px-1">k</kbd>
            {" navigate "}
            <kbd className="rounded-sm border border-border bg-muted px-1">e</kbd>
            {" accept risk "}
            <kbd className="rounded-sm border border-border bg-muted px-1">f</kbd>
            {" false positive "}
            <kbd className="rounded-sm border border-border bg-muted px-1">o</kbd>
            {" open"}
          </div>
        </div>
      </div>

      {/* Renders every filtered finding; not actually windowed yet, so a 10k-finding
          review will mount 10k DOM nodes. Needs real windowing before that scale is safe. */}
      <div className="flex flex-col gap-2">
        {filteredFindings.length === 0 ? (
          <div className="rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No findings match the current filter criteria.
          </div>
        ) : (
          filteredFindings.map((finding, idx) => {
            const isSelected = idx === selectedIndex;
            const isWaived = finding.disposition === "accepted_risk" || finding.disposition === "false_positive";

            return (
              // `finding-scan-row` and `finding-triage-card` carry no styling any more --
              // kept as stable selector hooks for tests/unit/web/keyboard-triage.test.ts,
              // tests/e2e/review-lifecycle.spec.ts, and tests/e2e/modal-contract.spec.ts.
              // `selected-row` is kept alongside them for the same reason.
              <article
                key={finding.fingerprint}
                className={`finding-scan-row finding-triage-card rounded-md border p-3 ${isSelected ? "selected-row border-primary" : "border-border"} ${isWaived ? "opacity-60" : ""} bg-card`}
                data-selected={isSelected}
                onClick={() => setSelectedIndex(idx)}
                onFocus={() => setSelectedIndex(idx)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    setSelectedIndex(idx);
                  }
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-sm px-1.5 py-0.5 text-xs uppercase ${getSeverityBadgeClass(finding.severity)}`}
                    >
                      {finding.severity}
                    </span>
                    <span className={`rounded-sm px-1.5 py-0.5 text-xs ${getDiffStateBadgeClass(finding.diffState)}`}>
                      {finding.diffState}
                    </span>
                    <code className="text-xs">{finding.ruleId}</code>
                    {finding.component ? (
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {finding.component}
                      </span>
                    ) : null}
                  </div>

                  {/* `disposition-select` carries no styling any more -- kept as a stable
                      selector hook for tests/unit/web/findings-tab.test.ts,
                      tests/e2e/review-lifecycle.spec.ts, and tests/e2e/modal-contract.spec.ts. */}
                  <select
                    aria-label={`Disposition for finding ${finding.ruleId}`}
                    value={finding.disposition}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const newDisp = e.currentTarget.value as FindingDisposition;
                      if (newDisp === "accepted_risk" || newDisp === "false_positive") {
                        setModalFinding({ finding, targetDisposition: newDisp });
                      } else {
                        handleDirectDisposition(finding.fingerprint, newDisp);
                      }
                    }}
                    className="disposition-select rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground"
                  >
                    <option value="open">Open (Fix Required)</option>
                    <option value="fixed">Fixed</option>
                    <option value="accepted_risk">Accepted Risk (Waived)</option>
                    <option value="false_positive">False Positive</option>
                    <option value="not_applicable">Not Applicable</option>
                  </select>
                </div>

                <p className="mt-2 text-sm text-foreground">{finding.message}</p>

                {/* `finding-detail-grid` carries no styling any more -- kept as a stable
                    selector hook for tests/unit/web/keyboard-triage.test.ts. */}
                <div className="finding-detail-grid mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
                  <span>
                    📄 {finding.path} {finding.sheet ? `• Sheet: ${finding.sheet}` : ""}
                  </span>

                  {finding.decisionReason ? (
                    <div>
                      <span className="font-medium text-foreground">Decision ({finding.decisionOwner}):</span>{" "}
                      {finding.decisionReason}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <span>Assignee:</span>
                    <span className="text-foreground">
                      {finding.assignees.length > 0 ? finding.assignees.join(", ") : "Unassigned"}
                    </span>
                    {/* `assignee-input` and `assignee-add-btn` carry no styling any more --
                        kept as stable selector hooks for tests/unit/web/findings-tab.test.ts
                        and tests/e2e/review-lifecycle.spec.ts. */}
                    <input
                      type="text"
                      aria-label={`Add assignee for finding ${finding.ruleId}`}
                      placeholder="Add assignee…"
                      value={assigneeDraft[finding.fingerprint] ?? ""}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const value = e.currentTarget.value;
                        setAssigneeDraft((prev) => ({ ...prev, [finding.fingerprint]: value }));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAssign(finding.fingerprint, assigneeDraft[finding.fingerprint] ?? "");
                        }
                      }}
                      className="assignee-input rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground"
                    />
                    <button
                      type="button"
                      className="assignee-add-btn rounded-sm border border-border px-2 py-1 text-xs hover:bg-accent"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAssign(finding.fingerprint, assigneeDraft[finding.fingerprint] ?? "");
                      }}
                    >
                      Assign
                    </button>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>

      {modalFinding ? (
        <DecisionModal
          finding={modalFinding.finding}
          targetDisposition={modalFinding.targetDisposition}
          onConfirm={handleModalConfirm}
          onClose={() => setModalFinding(null)}
        />
      ) : null}
    </div>
  );
}
