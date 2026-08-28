"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, Panel, StatusBadge } from "../../components/ui.js";

export interface PolicyRecord {
  readonly id: string;
  readonly scope: "organization" | "team" | "repository";
  readonly scopeId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly requiredChecklist: readonly string[];
  readonly requiredRoles: readonly string[];
  readonly severityGate: "error" | "high" | "medium" | null;
  readonly requireEvidencePack: boolean;
  readonly requireExternalReview: boolean;
}

interface DraftPolicyState {
  scope: PolicyRecord["scope"];
  scopeId: string;
  name: string;
  description: string;
  requiredChecklist: string;
  requiredRoles: string;
  severityGate: "" | NonNullable<PolicyRecord["severityGate"]>;
  requireEvidencePack: boolean;
  requireExternalReview: boolean;
}

const emptyDraft: DraftPolicyState = {
  scope: "organization",
  scopeId: "",
  name: "",
  description: "",
  requiredChecklist: "",
  requiredRoles: "",
  severityGate: "error",
  requireEvidencePack: true,
  requireExternalReview: false,
};

function formatScopeLabel(scope: PolicyRecord["scope"]): string {
  if (scope === "organization") return "Organization Global";
  if (scope === "team") return "Team Scope";
  return "Repository Scope";
}

function mapGateTone(gate: "error" | "high" | "medium"): "danger" | "warning" | "info" {
  if (gate === "error") return "danger";
  if (gate === "high") return "warning";
  return "info";
}

interface PolicyCardProps {
  readonly policy: PolicyRecord;
  readonly onDelete: (id: string, name: string) => void;
}

function PolicyCard({ policy, onDelete }: PolicyCardProps) {
  const scopeLabel = formatScopeLabel(policy.scope);

  return (
    <article className="policy-card panel surface-raised">
      <header className="policy-card-header">
        <div className="policy-card-scope-bar">
          <span className={`policy-scope-chip ${policy.scope}`}>{scopeLabel}</span>
          {policy.scopeId ? <code className="policy-scope-id">{policy.scopeId}</code> : null}
        </div>
        <button
          type="button"
          className="button button-secondary button-small button-delete"
          onClick={() => onDelete(policy.id, policy.name)}
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
              <StatusBadge value={mapGateTone(policy.severityGate)} label={`Block on ${policy.severityGate}`} />
            ) : (
              <span className="advisory-pill">Advisory Only</span>
            )}
          </div>

          {policy.requireEvidencePack ? <span className="compliance-pill evidence">Evidence Pack Enforced</span> : null}

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
            <summary className="spec-label">Verification Checklist ({policy.requiredChecklist.length} items)</summary>
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
}

interface PolicyBuilderProps {
  readonly draft: DraftPolicyState;
  readonly submitting: boolean;
  readonly onChange: (next: DraftPolicyState) => void;
  readonly onSubmit: (event: React.FormEvent) => void;
  readonly onClose: () => void;
}

function PolicyBuilderForm({ draft, submitting, onChange, onSubmit, onClose }: PolicyBuilderProps) {
  const roleTags = draft.requiredRoles
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const checklistTags = draft.requiredChecklist
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <Panel
      title="Create Governance Policy"
      description="Define release blocking criteria, required approvers, and verification checks."
      tone="raised"
    >
      <form onSubmit={onSubmit} className="policy-builder-form">
        <div className="policy-form-grid">
          <fieldset className="form-section-card panel surface-default">
            <legend className="section-title">1. Scope & Identity</legend>
            <div className="form-group">
              <label htmlFor="policy-scope">Governance Scope *</label>
              <select
                id="policy-scope"
                value={draft.scope}
                onChange={(e) => onChange({ ...draft, scope: e.target.value as PolicyRecord["scope"] })}
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
                  onChange={(e) => onChange({ ...draft, scopeId: e.target.value })}
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
                onChange={(e) => onChange({ ...draft, name: e.target.value })}
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
                onChange={(e) => onChange({ ...draft, description: e.target.value })}
                placeholder="Describe the safety, fabrication, or quality purpose of this policy..."
                className="form-textarea"
                rows={2}
              />
            </div>
          </fieldset>

          <fieldset className="form-section-card panel surface-default">
            <legend className="section-title">2. Severity Gate & Approvers</legend>
            <div className="form-group">
              <label htmlFor="policy-gate">Minimum Severity Gate (Blocks Release)</label>
              <select
                id="policy-gate"
                value={draft.severityGate}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    severityGate: (e.target.value || "") as DraftPolicyState["severityGate"],
                  })
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
                onChange={(e) => onChange({ ...draft, requiredRoles: e.target.value })}
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
                onChange={(e) => onChange({ ...draft, requiredChecklist: e.target.value })}
                placeholder="e.g. DFM review confirmed, High-voltage clearance >= 1.5mm"
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

          <fieldset className="form-section-card panel surface-default">
            <legend className="section-title">3. Compliance & Evidence Pack</legend>
            <div className="checkbox-cards-group">
              <label className={`checkbox-card panel surface-sunken ${draft.requireEvidencePack ? "selected" : ""}`}>
                <input
                  type="checkbox"
                  checked={draft.requireEvidencePack}
                  onChange={(e) => onChange({ ...draft, requireEvidencePack: e.target.checked })}
                />
                <div className="checkbox-card-content">
                  <strong>Require Verified Evidence Pack</strong>
                  <p>
                    Mandates verified evidence digests bound to KiCad DRC reports, BOM snapshots, and release manifests.
                  </p>
                </div>
              </label>

              <label className={`checkbox-card panel surface-sunken ${draft.requireExternalReview ? "selected" : ""}`}>
                <input
                  type="checkbox"
                  checked={draft.requireExternalReview}
                  onChange={(e) => onChange({ ...draft, requireExternalReview: e.target.checked })}
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
          <button type="button" className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="button button-primary">
            {submitting ? "Saving Policy…" : "Save Policy"}
          </button>
        </footer>
      </form>
    </Panel>
  );
}

function PolicyInheritanceDiagram() {
  return (
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
  );
}

export default function PoliciesClient() {
  const [policies, setPolicies] = useState<PolicyRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftPolicyState>(emptyDraft);
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

  const hasPolicies = Boolean(policies && policies.length > 0);
  const scopeSummary = hasPolicies ? "Multi-Tenant Hierarchical" : "Default baseline";
  const enforcementSummary = hasPolicies ? "Pre-Fabrication Gates Active" : "Default open review";

  return (
    <div className="policies-workspace">
      <PolicyInheritanceDiagram />

      <section className="policies-toolbar decision-band" aria-label="Policies summary and actions">
        <div className="metric-strip">
          <span className="metric-pill">
            <strong>{policies?.length ?? 0}</strong> Active Policies
          </span>
          <span className="metric-pill">
            Scope: <strong>{scopeSummary}</strong>
          </span>
          <span className="metric-pill">
            Enforcement: <strong>{enforcementSummary}</strong>
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

      {error ? (
        <div className="alert-banner error" role="alert">
          {error}
        </div>
      ) : null}

      {successMessage ? <output className="alert-banner success">✓ {successMessage}</output> : null}

      {showBuilder ? (
        <PolicyBuilderForm
          draft={draft}
          submitting={submitting}
          onChange={setDraft}
          onSubmit={handleCreate}
          onClose={() => setShowBuilder(false)}
        />
      ) : null}

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
            {policies.map((policy) => (
              <PolicyCard key={policy.id} policy={policy} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
