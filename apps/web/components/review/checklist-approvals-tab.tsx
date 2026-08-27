"use client";

import { useState } from "react";
import type { DemoApproval, DemoChecklistItem } from "../../lib/demo-data.js";
import { Panel, StatusBadge } from "../ui.js";

export function ChecklistApprovalsTab({
  checklist: initialChecklist,
  approvals: initialApprovals,
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
  const [checklist, setChecklist] = useState(initialChecklist);
  const [approvals] = useState(initialApprovals);
  const [newItemTitle, setNewItemTitle] = useState("");

  function handleToggle(id: string) {
    setChecklist((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const nextCompleted = !item.completed;
          const updated: DemoChecklistItem = {
            id: item.id,
            title: item.title,
            completed: nextCompleted,
            ...(nextCompleted
              ? { completedBy: "current.user@company.com", completedAt: new Date().toISOString() }
              : {}),
          };
          onToggleChecklist?.(id, nextCompleted);
          return updated;
        }
        return item;
      }),
    );
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newItemTitle.trim()) return;

    const newItem: DemoChecklistItem = {
      id: `chk_${Date.now()}`,
      title: newItemTitle.trim(),
      completed: false,
    };

    setChecklist((prev) => [...prev, newItem]);
    onAddChecklist?.(newItemTitle.trim());
    setNewItemTitle("");
  }

  const completedCount = checklist.filter((i) => i.completed).length;

  return (
    <div className="checklist-tab-content">
      <Panel
        title="Hardware Verification Checklist"
        description={`${completedCount} of ${checklist.length} verification items completed.`}
        tone="raised"
      >
        <div className="checklist-progress-bar-wrap">
          <div
            className="checklist-progress-bar-fill"
            style={{ width: `${checklist.length > 0 ? (completedCount / checklist.length) * 100 : 0}%` }}
          />
        </div>

        <div className="checklist-items-list">
          {checklist.map((item) => (
            <label
              key={item.id}
              className={`checklist-item-row panel surface-default ${item.completed ? "completed" : ""}`}
            >
              <input
                type="checkbox"
                checked={item.completed}
                onChange={() => handleToggle(item.id)}
                className="checklist-checkbox"
              />
              <div className="checklist-item-info">
                <span className="checklist-item-title">{item.title}</span>
                {item.completed && item.completedBy ? (
                  <span className="checklist-item-meta">
                    Completed by {item.completedBy} at {new Date(item.completedAt ?? "").toLocaleTimeString()}
                  </span>
                ) : null}
              </div>
            </label>
          ))}
        </div>

        <form onSubmit={handleAdd} className="add-checklist-form">
          <input
            type="text"
            placeholder="Add custom verification check (e.g. 'Validate high-speed differential pairs match within 0.1mm')..."
            value={newItemTitle}
            onChange={(e) => setNewItemTitle(e.currentTarget.value)}
            className="form-input"
            required
          />
          <button type="submit" className="button button-secondary">
            + Add Check
          </button>
        </form>
      </Panel>

      <Panel
        title="Formal Approvals & Sign-Off Ledger"
        description="Append-only cryptographic record of engineering sign-offs bound to head evidence digests."
        tone="default"
      >
        <div className="approvals-table-wrap">
          <table className="approvals-table">
            <thead>
              <tr>
                <th>Approver</th>
                <th>Status</th>
                <th>Reason / Justification</th>
                <th>Evidence Digest</th>
                <th>Recorded At</th>
              </tr>
            </thead>
            <tbody>
              {approvals.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-muted">
                    No sign-offs recorded yet.
                  </td>
                </tr>
              ) : (
                approvals.map((app) => {
                  const isCurrentDigest = app.evidenceDigest === evidenceDigest;
                  return (
                    <tr key={app.id} className={app.status}>
                      <td>
                        <strong>{app.approverId}</strong>
                        {app.isBreakGlass ? <span className="break-glass-badge">⚡ Break-Glass</span> : null}
                      </td>
                      <td>
                        <StatusBadge
                          value={
                            app.status === "approved" ? "pass" : app.status === "invalidated" ? "warning" : "failed"
                          }
                          label={app.status}
                        />
                      </td>
                      <td>
                        {app.reason ?? "—"}
                        {app.invalidationReason ? (
                          <div className="invalidation-alert">⚠️ Invalidation: {app.invalidationReason}</div>
                        ) : null}
                      </td>
                      <td>
                        <code className="digest-code-short" title={app.evidenceDigest}>
                          {app.evidenceDigest.slice(0, 10)}...
                        </code>
                        {!isCurrentDigest ? (
                          <span className="stale-digest-tag" title="Targeted previous revision">
                            (previous)
                          </span>
                        ) : null}
                      </td>
                      <td>{new Date(app.createdAt).toLocaleString()}</td>
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
