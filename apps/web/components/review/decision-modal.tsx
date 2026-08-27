"use client";

import type { FindingDisposition } from "@boardreadyops/contracts";
import { useState } from "react";
import type { DemoFinding } from "../../lib/demo-data.js";

export interface DecisionModalProps {
  finding: DemoFinding;
  targetDisposition: FindingDisposition;
  onConfirm: (data: { reason: string; owner: string; expiresAt?: string }) => void;
  onClose: () => void;
}

export function DecisionModal({ finding, targetDisposition, onConfirm, onClose }: DecisionModalProps) {
  const isAcceptedRisk = targetDisposition === "accepted_risk";
  const [reason, setReason] = useState(finding.decisionReason ?? "");
  const [owner, setOwner] = useState(finding.decisionOwner ?? "engineer@company.com");
  const [expiresAt, setExpiresAt] = useState(finding.decisionExpiresAt ?? "");
  const [error, setError] = useState<string | null>(null);

  const minChars = isAcceptedRisk ? 20 : 5;
  const isValid = reason.trim().length >= minChars;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) {
      setError(`Justification must be at least ${minChars} characters.`);
      return;
    }
    onConfirm({
      reason: reason.trim(),
      owner: owner.trim(),
      ...(expiresAt ? { expiresAt } : {}),
    });
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="decision-modal-title">
      <div className="modal-panel panel surface-raised">
        <header className="modal-header">
          <h2 id="decision-modal-title">
            Record Finding Decision: <span className="text-highlight">{targetDisposition.replace("_", " ")}</span>
          </h2>
          <button type="button" className="modal-close-button" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </header>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="finding-modal-context">
            <span className="rule-badge">{finding.ruleId}</span>
            <span className="component-badge">{finding.component ?? "Global"}</span>
            <p className="finding-msg">{finding.message}</p>
          </div>

          <div className="form-group">
            <label htmlFor="decision-reason">
              Engineering Justification Reason <span className="text-danger">*</span>
            </label>
            <textarea
              id="decision-reason"
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.currentTarget.value);
                setError(null);
              }}
              placeholder={
                isAcceptedRisk
                  ? "Describe why this risk is acceptable for fabrication (min 20 characters)..."
                  : "Explain reason for this decision..."
              }
              className="form-textarea"
              required
            />
            <div className="char-counter">
              <span className={reason.trim().length >= minChars ? "text-success" : "text-muted"}>
                {reason.trim().length} / {minChars} characters required
              </span>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label htmlFor="decision-owner">Decision Owner / Approver</label>
              <input
                type="email"
                id="decision-owner"
                value={owner}
                onChange={(e) => setOwner(e.currentTarget.value)}
                className="form-input"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="decision-expires">Expiry Date (Optional Waiver Sunset)</label>
              <input
                type="date"
                id="decision-expires"
                value={expiresAt ?? ""}
                onChange={(e) => setExpiresAt(e.currentTarget.value)}
                className="form-input"
              />
            </div>
          </div>

          {error ? <div className="form-error-alert">{error}</div> : null}

          <footer className="modal-footer">
            <button type="button" className="button button-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button button-primary" disabled={!isValid}>
              Save Decision
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
