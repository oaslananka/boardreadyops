"use client";

import { useId, useState } from "react";
import type { DemoApproval, DemoChecklistItem } from "../../lib/demo-data.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Panel, StatusBadge } from "../ui.js";

export function ChecklistApprovalsTab({
  checklist,
  approvals,
  evidenceDigest,
  onToggleChecklist,
  onAddChecklist,
}: {
  checklist: DemoChecklistItem[];
  approvals: DemoApproval[];
  evidenceDigest: string;
  onToggleChecklist?: (id: string, completed: boolean) => void;
  onAddChecklist?: (title: string) => void;
}) {
  const [newItemTitle, setNewItemTitle] = useState("");
  const newItemFieldId = useId();

  function handleToggle(id: string) {
    const item = checklist.find((c) => c.id === id);
    if (!item) return;
    onToggleChecklist?.(id, !item.completed);
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newItemTitle.trim()) return;
    onAddChecklist?.(newItemTitle.trim());
    setNewItemTitle("");
  }

  const completedCount = checklist.filter((i) => i.completed).length;

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Hardware Verification Checklist"
        description={`${completedCount} of ${checklist.length} verification items completed.`}
        tone="raised"
      >
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${checklist.length > 0 ? (completedCount / checklist.length) * 100 : 0}%` }}
          />
        </div>

        <div className="mt-3 flex flex-col gap-2">
          {checklist.map((item) => (
            <label
              key={item.id}
              className={`flex items-start gap-3 rounded-md border border-border bg-card p-3 ${item.completed ? "opacity-70" : ""}`}
            >
              <input
                type="checkbox"
                checked={item.completed}
                onChange={() => handleToggle(item.id)}
                className="mt-0.5"
              />
              <div>
                <span
                  className={`text-sm ${item.completed ? "text-muted-foreground line-through" : "text-foreground"}`}
                >
                  {item.title}
                </span>
                {item.completed && item.completedBy ? (
                  <span className="block text-xs text-muted-foreground">
                    Completed by {item.completedBy} at {new Date(item.completedAt ?? "").toLocaleString()}
                  </span>
                ) : null}
              </div>
            </label>
          ))}
        </div>

        <form onSubmit={handleAdd} className="mt-4 flex gap-2">
          <label htmlFor={newItemFieldId} className="sr-only">
            Add custom verification check
          </label>
          <input
            id={newItemFieldId}
            type="text"
            placeholder="Add custom verification check (e.g. 'Validate high-speed differential pairs match within 0.1mm')..."
            value={newItemTitle}
            onChange={(e) => setNewItemTitle(e.currentTarget.value)}
            className="w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            required
          />
          <Button type="submit" variant="secondary">
            + Add Check
          </Button>
        </form>
      </Panel>

      <Panel
        title="Formal Approvals & Sign-Off Ledger"
        description="Engineering sign-offs recorded against revision evidence digests."
        tone="default"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-3">Approver</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Reason / Justification</th>
                <th className="py-2 pr-3">Evidence Digest</th>
                <th className="py-2 pr-3">Recorded At</th>
              </tr>
            </thead>
            <tbody>
              {approvals.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-muted-foreground">
                    No sign-offs recorded yet.
                  </td>
                </tr>
              ) : (
                approvals.map((app) => {
                  const isCurrentDigest = app.evidenceDigest === evidenceDigest;
                  return (
                    <tr key={app.id} className="border-b border-border last:border-b-0">
                      <td className="py-2 pr-3">
                        <strong className="font-medium text-foreground">{app.approverId}</strong>
                        {app.isBreakGlass ? (
                          <Badge variant="warning" className="ml-2">
                            ⚡ Break-Glass
                          </Badge>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge
                          value={
                            app.status === "approved" ? "pass" : app.status === "invalidated" ? "warning" : "failed"
                          }
                          label={app.status}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        {app.reason ?? "—"}
                        {app.invalidationReason ? (
                          <div className="mt-1 text-xs text-danger">⚠️ Invalidation: {app.invalidationReason}</div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">
                        <code title={app.evidenceDigest}>{app.evidenceDigest.slice(0, 10)}...</code>
                        {!isCurrentDigest ? (
                          <span className="ml-1 text-xs text-muted-foreground" title="Targeted previous revision">
                            (previous)
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">{new Date(app.createdAt).toLocaleString()}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
