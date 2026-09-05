"use client";

import type { FindingDisposition } from "@boardreadyops/contracts";
import { useState } from "react";
import type { DemoFinding } from "../../lib/demo-data.js";
import { Dialog } from "../dialog.js";
import { Button } from "../ui/button.js";

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
    <Dialog titleId="decision-modal-title" onClose={onClose}>
      <header className="flex items-center justify-between border-b border-border p-4">
        <h2 id="decision-modal-title" className="text-base font-bold text-foreground">
          Record Finding Decision: <span className="text-primary">{targetDisposition.replace("_", " ")}</span>
        </h2>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label="Close modal"
        >
          ✕
        </button>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">
        <div className="rounded-md bg-muted px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-sm bg-card px-1.5 py-0.5">{finding.ruleId}</span>
            <span className="rounded-sm bg-card px-1.5 py-0.5">{finding.component ?? "Global"}</span>
          </div>
          <p className="mt-1 text-sm text-foreground">{finding.message}</p>
        </div>

        <div>
          <label htmlFor="decision-reason" className="text-sm font-medium text-foreground">
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
            className="mt-1 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            required
          />
          <div className="mt-1 text-xs">
            <span className={reason.trim().length >= minChars ? "text-success" : "text-muted-foreground"}>
              {reason.trim().length} / {minChars} characters required
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="decision-owner" className="text-sm font-medium text-foreground">
              Decision Owner / Approver
            </label>
            <input
              type="email"
              id="decision-owner"
              value={owner}
              onChange={(e) => setOwner(e.currentTarget.value)}
              className="mt-1 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              required
            />
          </div>

          <div>
            <label htmlFor="decision-expires" className="text-sm font-medium text-foreground">
              Expiry Date (Optional Waiver Sunset)
            </label>
            <input
              type="date"
              id="decision-expires"
              value={expiresAt ?? ""}
              onChange={(e) => setExpiresAt(e.currentTarget.value)}
              className="mt-1 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-danger/40 bg-danger-surface px-3 py-2 text-sm text-danger">
            {error}
          </div>
        ) : null}

        <footer className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!isValid}>
            Save Decision
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
