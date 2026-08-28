"use client";

import { useState } from "react";

export interface ApprovalModalProps {
  readonly type: "approve" | "request_changes";
  readonly evidenceDigest: string;
  readonly isSubmitting?: boolean;
  readonly serverError?: string | null;
  readonly onConfirm: (data: { reason: string; isBreakGlass?: boolean }) => void;
  readonly onClose: () => void;
}

function getSubmitButtonLabel(isSubmitting: boolean, isApprove: boolean): string {
  if (isSubmitting) return "Recording...";
  return isApprove ? "Confirm Sign-Off" : "Submit Change Request";
}

export function ApprovalModal({
  type,
  evidenceDigest,
  isSubmitting = false,
  serverError = null,
  onConfirm,
  onClose,
}: ApprovalModalProps) {
  const isApprove = type === "approve";
  const [reason, setReason] = useState("");
  const [isBreakGlass, setIsBreakGlass] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isApprove && !reason.trim()) {
      setError("Please specify what changes are required before fabrication.");
      return;
    }
    onConfirm({
      reason: reason.trim(),
      ...(isBreakGlass ? { isBreakGlass: true } : {}),
    });
  }

  const submitLabel = getSubmitButtonLabel(isSubmitting, isApprove);
  const title = isApprove ? "Record Engineering Sign-Off" : "Request Hardware Changes";
  const reasonLabel = isApprove ? "Sign-Off Notes (Optional)" : "Required Changes & Action Items *";
  const reasonPlaceholder = isApprove
    ? "e.g. Reviewed high-voltage clearance, thermal vias, and CAN isolation barrier. Approved for prototype run."
    : "e.g. Clearance between ISO_CAN_VCC and GND must be increased to >= 0.50mm.";
  const displayError = error ?? serverError;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="approval-modal-title">
      <div className="modal-panel panel surface-raised">
        <header className="modal-header">
          <h2 id="approval-modal-title">{title}</h2>
          <button
            type="button"
            className="modal-close-button"
            onClick={onClose}
            aria-label="Close modal"
            disabled={isSubmitting}
          >
            ✕
          </button>
        </header>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="approval-digest-badge">
            <span>Bound to Evidence Digest:</span>
            <code>{evidenceDigest.slice(0, 16)}...</code>
          </div>

          <div className="form-group">
            <label htmlFor="approval-reason">{reasonLabel}</label>
            <textarea
              id="approval-reason"
              rows={3}
              value={reason}
              disabled={isSubmitting}
              onChange={(e) => {
                setReason(e.currentTarget.value);
                setError(null);
              }}
              placeholder={reasonPlaceholder}
              className="form-textarea"
              required={!isApprove}
            />
          </div>

          {isApprove ? (
            <div className="form-group break-glass-toggle">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={isBreakGlass}
                  disabled={isSubmitting}
                  onChange={(e) => setIsBreakGlass(e.currentTarget.checked)}
                />
                <span>⚡ Break-Glass Override (Emergency sign-off with audit logging)</span>
              </label>
            </div>
          ) : null}

          {displayError ? <div className="form-error-alert">{displayError}</div> : null}

          <footer className="modal-footer">
            <button type="button" className="button button-secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button
              type="submit"
              className={`button ${isApprove ? "button-primary" : "button-danger"}`}
              disabled={isSubmitting}
            >
              {submitLabel}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
