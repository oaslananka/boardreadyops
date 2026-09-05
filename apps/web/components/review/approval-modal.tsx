"use client";

import { useState } from "react";
import { Dialog } from "../dialog.js";
import { Button } from "../ui/button.js";

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
    <Dialog titleId="approval-modal-title" onClose={onClose}>
      <header className="flex items-center justify-between border-b border-border p-4">
        <h2 id="approval-modal-title" className="text-base font-bold text-foreground">
          {title}
        </h2>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label="Close modal"
          disabled={isSubmitting}
        >
          ✕
        </button>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          <span>Bound to Evidence Digest:</span>
          <code>{evidenceDigest.slice(0, 16)}...</code>
        </div>

        <div>
          <label htmlFor="approval-reason" className="text-sm font-medium text-foreground">
            {reasonLabel}
          </label>
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
            className="mt-1 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            required={!isApprove}
          />
        </div>

        {isApprove ? (
          <div>
            <label className="flex items-center gap-2 text-sm text-foreground">
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

        {displayError ? (
          <div className="rounded-md border border-danger/40 bg-danger-surface px-3 py-2 text-sm text-danger">
            {displayError}
          </div>
        ) : null}

        <footer className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant={isApprove ? "default" : "destructive"} disabled={isSubmitting}>
            {submitLabel}
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
