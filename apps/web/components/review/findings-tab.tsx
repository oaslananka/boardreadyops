"use client";

import type { FindingDisposition } from "@boardreadyops/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DemoFinding } from "../../lib/demo-data.js";
import { DecisionModal } from "./decision-modal.js";

export interface FindingsTabProps {
  findings: DemoFinding[];
  onUpdateDisposition?: (fingerprint: string, disposition: FindingDisposition, reason?: string, owner?: string) => void;
  onAssign?: (fingerprint: string, assignee: string) => void;
}

export function FindingsTab({ findings: initialFindings, onUpdateDisposition, onAssign: _onAssign }: FindingsTabProps) {
  const [findings, setFindings] = useState(initialFindings);
  const [selectedDiffState, setSelectedDiffState] = useState<string>("all");
  const [selectedSeverity, setSelectedSeverity] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [modalFinding, setModalFinding] = useState<{
    finding: DemoFinding;
    targetDisposition: FindingDisposition;
  } | null>(null);

  useEffect(() => {
    setFindings(initialFindings);
  }, [initialFindings]);

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
      setFindings((prev) => prev.map((f) => (f.fingerprint === fingerprint ? { ...f, disposition } : f)));
      onUpdateDisposition?.(fingerprint, disposition);
    },
    [onUpdateDisposition],
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
    setFindings((prev) =>
      prev.map((f) =>
        f.fingerprint === finding.fingerprint
          ? {
              ...f,
              disposition: targetDisposition,
              decisionReason: data.reason,
              decisionOwner: data.owner,
              decisionExpiresAt: data.expiresAt ?? null,
            }
          : f,
      ),
    );
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
        <div className="diff-state-tabs" role="tablist">
          <button
            type="button"
            className={`tab-btn ${selectedDiffState === "all" ? "active" : ""}`}
            onClick={() => {
              setSelectedDiffState("all");
              setSelectedIndex(0);
            }}
          >
            All ({counts.all})
          </button>
          <button
            type="button"
            className={`tab-btn new-state ${selectedDiffState === "new" ? "active" : ""}`}
            onClick={() => {
              setSelectedDiffState("new");
              setSelectedIndex(0);
            }}
          >
            + New ({counts.new})
          </button>
          <button
            type="button"
            className={`tab-btn persistent-state ${selectedDiffState === "persistent" ? "active" : ""}`}
            onClick={() => {
              setSelectedDiffState("persistent");
              setSelectedIndex(0);
            }}
          >
            Persistent ({counts.persistent})
          </button>
          <button
            type="button"
            className={`tab-btn regressed-state ${selectedDiffState === "regressed" ? "active" : ""}`}
            onClick={() => {
              setSelectedDiffState("regressed");
              setSelectedIndex(0);
            }}
          >
            ⚠ Regressed ({counts.regressed})
          </button>
          <button
            type="button"
            className={`tab-btn resolved-state ${selectedDiffState === "resolved" ? "active" : ""}`}
            onClick={() => {
              setSelectedDiffState("resolved");
              setSelectedIndex(0);
            }}
          >
            ✓ Resolved ({counts.resolved})
          </button>
        </div>

        <div className="triage-filter-row">
          <input
            type="search"
            placeholder="Search rule, component, message..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.currentTarget.value);
              setSelectedIndex(0);
            }}
            className="form-input triage-search"
          />

          <select
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
            <span>Shortcuts:</span>
            <kbd>j</kbd>/<kbd>k</kbd> navigate
            <kbd>e</kbd> accept risk
            <kbd>f</kbd> false positive
            <kbd>o</kbd> open
          </div>
        </div>
      </div>

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
                className={`finding-triage-card panel ${isSelected ? "selected-row" : ""} ${isWaived ? "waived-card" : ""}`}
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
                      value={finding.disposition}
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

                <div className="finding-card-footer">
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
