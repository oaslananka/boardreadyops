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
    <div className="findings-tab-content">
      <div className="findings-triage-toolbar panel">
        <div className="diff-state-tabs" role="tablist" aria-label="Filter findings by diff state">
          <button
            id="diff-state-tab-all"
            type="button"
            role="tab"
            aria-selected={selectedDiffState === "all"}
            tabIndex={selectedDiffState === "all" ? 0 : -1}
            className={`tab-btn ${selectedDiffState === "all" ? "active" : ""}`}
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
            className={`tab-btn new-state ${selectedDiffState === "new" ? "active" : ""}`}
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
            className={`tab-btn persistent-state ${selectedDiffState === "persistent" ? "active" : ""}`}
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
            className={`tab-btn regressed-state ${selectedDiffState === "regressed" ? "active" : ""}`}
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
            className={`tab-btn resolved-state ${selectedDiffState === "resolved" ? "active" : ""}`}
            onClick={() => {
              setSelectedDiffState("resolved");
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => handleDiffStateTabKeyDown(e, "resolved")}
          >
            ✓ Resolved ({counts.resolved})
          </button>
        </div>

        <div className="triage-filter-row">
          <input
            type="search"
            aria-label="Search findings"
            placeholder="Search rule, component, message..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.currentTarget.value);
              setSelectedIndex(0);
            }}
            className="form-input triage-search"
          />

          <select
            aria-label="Filter by severity"
            value={selectedSeverity}
            onChange={(e) => {
              setSelectedSeverity(e.currentTarget.value);
              setSelectedIndex(0);
            }}
            className="form-select triage-severity-select"
          >
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>

          <div className="keyboard-shortcuts-hint">
            <span>Shortcuts: </span>
            <kbd>j</kbd>/<kbd>k</kbd>
            {" navigate "}
            <kbd>e</kbd>
            {" accept risk "}
            <kbd>f</kbd>
            {" false positive "}
            <kbd>o</kbd>
            {" open"}
          </div>
        </div>
      </div>

      {/* Renders every filtered finding; not actually windowed yet, so a 10k-finding
          review will mount 10k DOM nodes. Needs real windowing before that scale is safe. */}
      <div className="findings-virtual-list">
        {filteredFindings.length === 0 ? (
          <div className="panel empty-findings">
            <p>No findings match the current filter criteria.</p>
          </div>
        ) : (
          filteredFindings.map((finding, idx) => {
            const isSelected = idx === selectedIndex;
            const isWaived = finding.disposition === "accepted_risk" || finding.disposition === "false_positive";

            return (
              <article
                key={finding.fingerprint}
                className={`finding-scan-row finding-triage-card panel ${isSelected ? "selected-row" : ""} ${isWaived ? "waived-card" : ""}`}
                data-selected={isSelected}
                onClick={() => setSelectedIndex(idx)}
                onFocus={() => setSelectedIndex(idx)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    setSelectedIndex(idx);
                  }
                }}
              >
                <div className="finding-card-header">
                  <div className="finding-header-left">
                    <span className={`severity-pill ${finding.severity}`}>{finding.severity}</span>
                    <span className={`diff-pill ${finding.diffState}`}>{finding.diffState}</span>
                    <code className="finding-rule-id">{finding.ruleId}</code>
                    {finding.component ? <span className="finding-comp-badge">{finding.component}</span> : null}
                  </div>

                  <div className="finding-header-right">
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
                      className={`disposition-select ${finding.disposition}`}
                    >
                      <option value="open">Open (Fix Required)</option>
                      <option value="fixed">Fixed</option>
                      <option value="accepted_risk">Accepted Risk (Waived)</option>
                      <option value="false_positive">False Positive</option>
                      <option value="not_applicable">Not Applicable</option>
                    </select>
                  </div>
                </div>

                <p className="finding-card-message">{finding.message}</p>

                <div className="finding-detail-grid finding-card-footer">
                  <span className="finding-path">
                    📄 {finding.path} {finding.sheet ? `• Sheet: ${finding.sheet}` : ""}
                  </span>

                  {finding.decisionReason ? (
                    <div className="decision-note">
                      <span className="decision-note-label">Decision ({finding.decisionOwner}):</span>
                      <span className="decision-note-text">{finding.decisionReason}</span>
                    </div>
                  ) : null}

                  <div className="finding-assignee-strip">
                    <span className="assignee-label">Assignee:</span>
                    <span className="assignee-val">
                      {finding.assignees.length > 0 ? finding.assignees.join(", ") : "Unassigned"}
                    </span>
                    <input
                      type="text"
                      aria-label={`Add assignee for finding ${finding.ruleId}`}
                      className="assignee-input"
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
                    />
                    <button
                      type="button"
                      className="assignee-add-btn"
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
