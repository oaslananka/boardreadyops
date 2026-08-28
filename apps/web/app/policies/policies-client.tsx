"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, Panel, StatusBadge } from "../../components/ui.js";

export interface PolicyRecord {
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
  severityGate: "error" as "" | PolicyRecord["severityGate"],
  requireEvidencePack: true,
  requireExternalReview: false,
};

export default function PoliciesClient() {
  const [policies, setPolicies] = useState<PolicyRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [submitting, setSubmitting] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);

  const loadPolicies = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/policies");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || `Server returned error (${res.status})`);
        setPolicies([]);
        return;
      }
      const body = (await res.json()) as { ok: boolean; policies?: PolicyRecord[]; error?: string };
      if (body.ok && Array.isArray(body.policies)) {
        setPolicies(body.policies);
        setError(null);
      } else {
        setError(body.error || "Failed to parse policies");
        setPolicies([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error loading policies");
      setPolicies([]);
    }
  }, []);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || submitting) return;

    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    const checklistItems = draft.requiredChecklist
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const roleItems = draft.requiredRoles
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const payload = {
      scope: draft.scope,
      scopeId: draft.scope === "organization" ? undefined : draft.scopeId.trim() || undefined,
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      requiredChecklist: checklistItems,
      requiredRoles: roleItems,
      severityGate: draft.severityGate || undefined,
      requireEvidencePack: draft.requireEvidencePack,
      requireExternalReview: draft.requireExternalReview,
    };

    try {
      const res = await fetch("/api/v1/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { ok: boolean; policy?: PolicyRecord; error?: string };

      if (!res.ok || !body.ok || !body.policy) {
        setError(body.error || `Failed to create policy (${res.status})`);
        setSubmitting(false);
        return;
      }

      setSuccessMessage(`Policy "${draft.name}" created and enforced.`);
      setDraft(emptyDraft);
      setShowBuilder(false);
      await loadPolicies();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error creating policy");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(`/api/v1/policies/${id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error || `Failed to delete policy (${res.status})`);
        return;
      }
      setSuccessMessage(`Policy "${name}" removed from enforcement.`);
      await loadPolicies();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error deleting policy");
    }
  }

  const checklistTags = draft.requiredChecklist
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const roleTags = draft.requiredRoles
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className="policies-workspace">
      {/* Inheritance Architecture Flow Banner */}
      <section className="policy-inheritance-diagram panel surface-inset" aria-label="Policy inheritance hierarchy">
        <div className="inheritance-lead">
          <h3>Policy Hierarchy & Scope Resolution</h3>
          <p>
            BoardReadyOps resolves governance rules top-down with strict inheritance. Repositories inherit organization
            and team baselines. Stricter rules apply automatically; exceptions require formal review waivers.
          </p>
        </div>
        <div className="inheritance-layers-grid">
          <div className="inheritance-layer-card organization">
            <div className="layer-badge">Level 1: Global</div>
            <h4>Organization</h4>
            <p>Baseline severity gates, mandatory DFM checks, and global sign-off requirements.</p>
          </div>
          <div className="inheritance-arrow" aria-hidden="true">
            →
          </div>
          <div className="inheritance-layer-card team">
            <div className="layer-badge">Level 2: Domain</div>
            <h4>Team Scope</h4>
            <p>Domain-specific criteria (e.g. RF impedance, automotive isolation, power rail integrity).</p>
          </div>
          <div className="inheritance-arrow" aria-hidden="true">
            →
          </div>
          <div className="inheritance-layer-card repository">
            <div className="layer-badge">Level 3: Project</div>
            <h4>Repository</h4>
            <p>Per-board tighter tolerances, stackup layer count rules, and custom verification checklists.</p>
          </div>
          <div className="inheritance-arrow" aria-hidden="true">
            →
          </div>
          <div className="inheritance-layer-card exception">
            <div className="layer-badge">Level 4: Waiver</div>
            <h4>Review Exception</h4>
            <p>Time-bound, break-glass sign-offs and auditable risk acceptances.</p>
          </div>
        </div>
      </section>

      {/* Metrics & Action Toolbar */}
      <section className="policies-toolbar decision-band" aria-label="Policies summary and actions">
        <div className="metric-strip">
          <span className="metric-pill">
            <strong>{policies?.length ?? 0}</strong> Active Policies
          </span>
          <span className="metric-pill">
            Scope: <strong>{policies && policies.length > 0 ? "Multi-Tenant Hierarchical" : "Default baseline"}</strong>
          </span>
          <span className="metric-pill">
            Enforcement:{" "}
            <strong>{policies && policies.length > 0 ? "Pre-Fabrication Gates Active" : "Default open review"}</strong>
          </span>
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className={`button ${showBuilder ? "button-secondary" : "button-primary"}`}
            onClick={() => {
              setShowBuilder(!showBuilder);
              setError(null);
              setSuccessMessage(null);
            }}
          >
            {showBuilder ? "✕ Close Policy Builder" : "+ New Governance Policy"}
          </button>
        </div>
      </section>

      {error && (
        <div className="alert-banner error" role="alert">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="alert-banner success" role="status">
          ✓ {successMessage}
        </div>
      )}

      {/* Interactive Policy Builder */}
      {showBuilder ? (
        <Panel
          title="Create Governance Policy"
          description="Define release blocking criteria, required approvers, and verification checks."
          tone="raised"
        >
          <form onSubmit={handleCreate} className="policy-builder-form">
            <div className="policy-form-grid">
              {/* Fieldset 1: Identity & Scope */}
              <fieldset className="form-section-card panel surface-default">
                <legend className="section-title">1. Scope & Identity</legend>
                <div className="form-group">
                  <label htmlFor="policy-scope">Governance Scope *</label>
                  <select
                    id="policy-scope"
                    value={draft.scope}
                    onChange={(e) => setDraft({ ...draft, scope: e.target.value as PolicyRecord["scope"] })}
                    className="form-select"
                  >
                    <option value="organization">Organization (Global baseline for all repositories)</option>
                    <option value="team">Team (Applies to all repositories owned by a team)</option>
                    <option value="repository">Repository (Specific hardware board repository)</option>
                  </select>
                </div>

                {draft.scope !== "organization" ? (
                  <div className="form-group">
                    <label htmlFor="policy-scope-id">
                      {draft.scope === "team" ? "Team Identifier *" : "Repository Path / ID *"}
                    </label>
                    <input
                      id="policy-scope-id"
                      value={draft.scopeId}
                      onChange={(e) => setDraft({ ...draft, scopeId: e.target.value })}
                      placeholder={draft.scope === "team" ? "e.g. rf-engineering" : "e.g. acme/power-distribution"}
                      className="form-input"
                      required
                    />
                    <span className="field-help">
                      {draft.scope === "team"
                        ? "Slug or name of the engineering team"
                        : "Full repository name or identifier"}
                    </span>
                  </div>
                ) : null}

                <div className="form-group">
                  <label htmlFor="policy-name">Policy Name *</label>
                  <input
                    id="policy-name"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="e.g. High-Voltage Creepage & Clearance Gate"
                    className="form-input"
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="policy-desc">Policy Description</label>
                  <textarea
                    id="policy-desc"
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    placeholder="Describe the safety, fabrication, or quality purpose of this policy..."
                    className="form-textarea"
                    rows={2}
                  />
                </div>
              </fieldset>

              {/* Fieldset 2: Severity Gates & Verification */}
              <fieldset className="form-section-card panel surface-default">
                <legend className="section-title">2. Severity Gate & Approvers</legend>
                <div className="form-group">
                  <label htmlFor="policy-gate">Minimum Severity Gate (Blocks Release)</label>
                  <select
                    id="policy-gate"
                    value={draft.severityGate ?? ""}
                    onChange={(e) =>
                      setDraft({ ...draft, severityGate: (e.target.value || null) as PolicyRecord["severityGate"] })
                    }
                    className="form-select"
                  >
                    <option value="">None (Advisory only)</option>
                    <option value="error">Block on Critical & Error findings (Recommended)</option>
                    <option value="high">Block on High, Critical & Error findings</option>
                    <option value="medium">Block on Medium and higher findings</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="policy-roles">Required Approver Roles (Comma-separated)</label>
                  <input
                    id="policy-roles"
                    value={draft.requiredRoles}
                    onChange={(e) => setDraft({ ...draft, requiredRoles: e.target.value })}
                    placeholder="e.g. hardware-lead, compliance, rf-specialist"
                    className="form-input"
                  />
                  {roleTags.length > 0 ? (
                    <div className="form-tag-preview">
                      {roleTags.map((r) => (
                        <span key={r} className="policy-tag role">
                          Role: {r}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="field-help">Design sign-offs require approval from designated roles.</span>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="policy-checklist">Required Verification Checklist Items (Comma-separated)</label>
                  <input
                    id="policy-checklist"
                    value={draft.requiredChecklist}
                    onChange={(e) => setDraft({ ...draft, requiredChecklist: e.target.value })}
                    placeholder="e.g. DFM review confirmed, High-voltage clearance >= 1.5mm, Thermal via count verified"
                    className="form-input"
                  />
                  {checklistTags.length > 0 ? (
                    <div className="form-tag-preview">
                      {checklistTags.map((c) => (
                        <span key={c} className="policy-tag check">
                          Check: {c}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="field-help">Reviewers must check off these items before sign-off passes.</span>
                  )}
                </div>
              </fieldset>

              {/* Fieldset 3: Compliance & Cryptographic Evidence */}
              <fieldset className="form-section-card panel surface-default">
                <legend className="section-title">3. Compliance & Cryptographic Evidence</legend>
                <div className="checkbox-cards-group">
                  <label
                    className={`checkbox-card panel surface-sunken ${draft.requireEvidencePack ? "selected" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={draft.requireEvidencePack}
                      onChange={(e) => setDraft({ ...draft, requireEvidencePack: e.target.checked })}
                    />
                    <div className="checkbox-card-content">
                      <strong>Require Cryptographic Evidence Pack</strong>
                      <p>
                        Mandates signed evidence digests bound to KiCad DRC reports, BOM snapshots, and release
                        manifests.
                      </p>
                    </div>
                  </label>

                  <label
                    className={`checkbox-card panel surface-sunken ${draft.requireExternalReview ? "selected" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={draft.requireExternalReview}
                      onChange={(e) => setDraft({ ...draft, requireExternalReview: e.target.checked })}
                    />
                    <div className="checkbox-card-content">
                      <strong>Require External / Third-Party Review</strong>
                      <p>Mandates external partner, lab, or customer sign-off before manufacturing gate is unlocked.</p>
                    </div>
                  </label>
                </div>
              </fieldset>
            </div>

            <footer className="policy-builder-footer">
              <button type="button" className="button button-secondary" onClick={() => setShowBuilder(false)}>
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="button button-primary">
                {submitting ? "Saving Policy…" : "Save Policy"}
              </button>
            </footer>
          </form>
        </Panel>
      ) : null}

      {/* Active Policies List */}
      <section className="active-policies-section" aria-label="Active governance policies">
        <header className="section-header">
          <div>
            <h2>Active Governance Policies</h2>
            <p>Rules currently enforced on all hardware pull requests and release sign-offs.</p>
          </div>
        </header>

        {policies === null ? (
          <div className="loading-container panel surface-default">
            <p>Loading governance policies…</p>
          </div>
        ) : policies.length === 0 ? (
          <Panel title="No Policies Configured">
            <EmptyState
              title="No governance policies configured yet"
              action={
                <button type="button" className="button button-primary" onClick={() => setShowBuilder(true)}>
                  + Create Governance Policy
                </button>
              }
            >
              <p>
                Hardware reviews currently use default open policy behavior. Creating a policy enables explicit release
                gates, required approver roles, and mandatory verification checklists.
              </p>
            </EmptyState>
          </Panel>
        ) : (
          <div className="policies-grid">
            {policies.map((policy) => {
              const isOrg = policy.scope === "organization";
              const isTeam = policy.scope === "team";
              return (
                <article key={policy.id} className="policy-card panel surface-raised">
                  <header className="policy-card-header">
                    <div className="policy-card-scope-bar">
                      <span className={`policy-scope-chip ${policy.scope}`}>
                        {isOrg ? "Organization Global" : isTeam ? "Team Scope" : "Repository Scope"}
                      </span>
                      {policy.scopeId ? <code className="policy-scope-id">{policy.scopeId}</code> : null}
                    </div>
                    <button
                      type="button"
                      className="button button-secondary button-small button-delete"
                      onClick={() => handleDelete(policy.id, policy.name)}
                      aria-label={`Delete policy ${policy.name}`}
                    >
                      Delete
                    </button>
                  </header>

                  <div className="policy-card-main">
                    <h3 className="policy-title">{policy.name}</h3>
                    {policy.description ? <p className="policy-description">{policy.description}</p> : null}

                    <div className="policy-gates-cluster">
                      <div className="gate-item">
                        <span className="gate-label">Severity Gate:</span>
                        {policy.severityGate ? (
                          <StatusBadge
                            value={
                              policy.severityGate === "error"
                                ? "danger"
                                : policy.severityGate === "high"
                                  ? "warning"
                                  : "info"
                            }
                            label={`Block on ${policy.severityGate}`}
                          />
                        ) : (
                          <span className="advisory-pill">Advisory Only</span>
                        )}
                      </div>

                      {policy.requireEvidencePack ? (
                        <span className="compliance-pill evidence">Evidence Pack Enforced</span>
                      ) : null}

                      {policy.requireExternalReview ? (
                        <span className="compliance-pill external">External Sign-Off Required</span>
                      ) : null}
                    </div>

                    {policy.requiredRoles.length > 0 ? (
                      <div className="policy-spec-row">
                        <span className="spec-label">Required Roles:</span>
                        <div className="spec-tags">
                          {policy.requiredRoles.map((role) => (
                            <span key={role} className="policy-tag role">
                              Role: {role}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {policy.requiredChecklist.length > 0 ? (
                      <details className="policy-spec-row">
                        <summary className="spec-label">
                          Verification Checklist ({policy.requiredChecklist.length} items)
                        </summary>
                        <ul className="policy-checklist-preview">
                          {policy.requiredChecklist.map((chk) => (
                            <li key={chk}>
                              <span className="check-icon">✓</span>
                              <span>{chk}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
