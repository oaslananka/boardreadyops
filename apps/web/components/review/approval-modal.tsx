"use client";

import { useState } from "react";

export interface ApprovalModalProps {
  type: "approve" | "request_changes";
  evidenceDigest: string;
  onConfirm: (data: { reason: string; isBreakGlass?: boolean }) => void;
  onClose: () => void;
}

export function ApprovalModal({ type, evidenceDigest, onConfirm, onClose }: ApprovalModalProps) {
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

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="approval-modal-title">
      <div className="modal-panel">
        <header className="modal-header">
          <h2 id="approval-modal-title">{isApprove ? "Record Engineering Sign-Off" : "Request Hardware Changes"}</h2>
          <button type="button" className="modal-close-button" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </header>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="approval-digest-badge">
            <span>Bound to Evidence Digest:</span>
            <code>{evidenceDigest.slice(0, 16)}...</code>
          </div>

          <div className="form-group">
            <label htmlFor="approval-reason">
              {isApprove ? "Sign-Off Notes (Optional)" : "Required Changes & Action Items *"}
            </label>
            <textarea
              id="approval-reason"
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.currentTarget.value);
                setError(null);
              }}
              placeholder={
                isApprove
                  ? "e.g. Reviewed high-voltage clearance, thermal vias, and CAN isolation barrier. Approved for prototype run."
                  : "e.g. Clearance between ISO_CAN_VCC and GND must be increased to >= 0.50mm."
              }
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
                  onChange={(e) => setIsBreakGlass(e.currentTarget.checked)}
                />
                <span>⚡ Break-Glass Override (Emergency sign-off with audit logging)</span>
              </label>
            </div>
          ) : null}

          {error ? <div className="form-error-alert">{error}</div> : null}

          <footer className="modal-footer">
            <button type="button" className="button button-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={`button ${isApprove ? "button-primary" : "button-danger"}`}>
              {isApprove ? "Confirm Sign-Off" : "Submit Change Request"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
