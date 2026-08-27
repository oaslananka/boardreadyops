"use client";

import { useCallback, useEffect, useState } from "react";

interface PolicyRecord {
  id: string;
  scope: "organization" | "team" | "repository";
  scopeId: string | null;
  name: string;
  description: string | null;
  requiredChecklist: string[];
  requiredRoles: string[];
  severityGate: "error" | "high" | "medium" | null;
  requireEvidencePack: boolean;
  requireExternalReview: boolean;
}

const emptyDraft = {
  scope: "organization" as PolicyRecord["scope"],
  scopeId: "",
  name: "",
  description: "",
  requiredChecklist: "",
  requiredRoles: "",
  severityGate: "" as "" | PolicyRecord["severityGate"],
  requireEvidencePack: false,
  requireExternalReview: false,
};

export default function PoliciesClient() {
  const [policies, setPolicies] = useState<PolicyRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [submitting, setSubmitting] = useState(false);

  const loadPolicies = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/policies");
      const body = (await res.json()) as { ok: boolean; policies?: PolicyRecord[]; error?: string };
      if (!body.ok) {
        setError(body.error ?? "Failed to load policies");
        setPolicies([]);
        return;
      }
      setPolicies(body.policies ?? []);
      setError(null);
    } catch {
      setError("Failed to reach the policies API");
      setPolicies([]);
    }
  }, []);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: draft.scope,
          scopeId: draft.scope === "organization" ? undefined : draft.scopeId || undefined,
          name: draft.name,
          description: draft.description || undefined,
          requiredChecklist: draft.requiredChecklist
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          requiredRoles: draft.requiredRoles
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          severityGate: draft.severityGate || undefined,
          requireEvidencePack: draft.requireEvidencePack,
          requireExternalReview: draft.requireExternalReview,
        }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) {
        setError(body.error ?? "Failed to create policy");
        return;
      }
      setDraft(emptyDraft);
      await loadPolicies();
    } catch {
      setError("Failed to reach the policies API");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/v1/policies/${id}`, { method: "DELETE" });
      await loadPolicies();
    } catch {
      setError("Failed to delete policy");
    }
  }

  return (
    <div>
      {error && (
        <p className="cell-note" role="alert">
          {error}
        </p>
      )}

      {policies === null ? (
        <p>Loading policies…</p>
      ) : policies.length === 0 ? (
        <p>No policy configured yet (defaults to open review).</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Scope</th>
              <th>Name</th>
              <th>Severity gate</th>
              <th>Required checklist</th>
              <th>Required roles</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {policies.map((policy) => (
              <tr key={policy.id}>
                <td>
                  {policy.scope}
                  {policy.scopeId ? ` (${policy.scopeId})` : ""}
                </td>
                <td>{policy.name}</td>
                <td>{policy.severityGate ?? "—"}</td>
                <td>{policy.requiredChecklist.join(", ") || "—"}</td>
                <td>{policy.requiredRoles.join(", ") || "—"}</td>
                <td>
                  <button type="button" onClick={() => handleDelete(policy.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={handleCreate}>
        <h2>New policy</h2>
        <label>
          Scope
          <select
            value={draft.scope}
            onChange={(e) => setDraft({ ...draft, scope: e.target.value as PolicyRecord["scope"] })}
          >
            <option value="organization">Organization</option>
            <option value="team">Team</option>
            <option value="repository">Repository</option>
          </select>
        </label>
        {draft.scope !== "organization" && (
          <label>
            Scope ID
            <input value={draft.scopeId} onChange={(e) => setDraft({ ...draft, scopeId: e.target.value })} required />
          </label>
        )}
        <label>
          Name
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
        </label>
        <label>
          Description
          <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </label>
        <label>
          Required checklist (comma-separated)
          <input
            value={draft.requiredChecklist}
            onChange={(e) => setDraft({ ...draft, requiredChecklist: e.target.value })}
          />
        </label>
        <label>
          Required approver roles (comma-separated)
          <input value={draft.requiredRoles} onChange={(e) => setDraft({ ...draft, requiredRoles: e.target.value })} />
        </label>
        <label>
          Severity gate
          <select
            value={draft.severityGate ?? ""}
            onChange={(e) => setDraft({ ...draft, severityGate: e.target.value as PolicyRecord["severityGate"] | "" })}
          >
            <option value="">None</option>
            <option value="error">error</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.requireEvidencePack}
            onChange={(e) => setDraft({ ...draft, requireEvidencePack: e.target.checked })}
          />
          Require evidence pack
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.requireExternalReview}
            onChange={(e) => setDraft({ ...draft, requireExternalReview: e.target.checked })}
          />
          Require external review
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create policy"}
        </button>
      </form>
    </div>
  );
}
