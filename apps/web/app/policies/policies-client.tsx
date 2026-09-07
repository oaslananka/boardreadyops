"use client";

import { useCallback, useEffect, useState } from "react";
import { Dialog } from "../../components/dialog.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { Textarea } from "../../components/ui/textarea.js";
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

function summarizeScope(policies: readonly PolicyRecord[]): string {
  if (policies.length === 0) return "Default baseline";
  const scopes = new Set(policies.map((p) => p.scope));
  if (scopes.size > 1) return "Multi-Tenant Hierarchical";
  const [onlyScope] = scopes;
  if (onlyScope === "organization") return "Organization-Only";
  if (onlyScope === "team") return "Team-Only";
  if (onlyScope === "repository") return "Repository-Only";
  return "Default baseline";
}

function summarizeEnforcement(policies: readonly PolicyRecord[]): string {
  if (policies.length === 0) return "Default open review";
  return policies.some((p) => p.severityGate !== null) ? "Pre-Fabrication Gates Active" : "Advisory Only";
}

interface PolicyCardProps {
  readonly policy: PolicyRecord;
  readonly onEdit: (policy: PolicyRecord) => void;
  readonly onDelete: (id: string, name: string) => void;
}

function PolicyCard({ policy, onEdit, onDelete }: PolicyCardProps) {
  const scopeLabel = formatScopeLabel(policy.scope);

  return (
    <article className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 shadow-lg">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">
            {scopeLabel}
          </span>
          {policy.scopeId ? <code className="text-xs">{policy.scopeId}</code> : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="button-small"
            onClick={() => onEdit(policy)}
            aria-label={`Edit policy ${policy.name}`}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="button-delete"
            onClick={() => onDelete(policy.id, policy.name)}
            aria-label={`Delete policy ${policy.name}`}
          >
            Delete
          </Button>
        </div>
      </header>

      <div>
        <h3 className="text-base font-bold text-foreground">{policy.name}</h3>
        {policy.description ? <p className="mt-1 text-sm text-muted-foreground">{policy.description}</p> : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Severity Gate:</span>
          {policy.severityGate ? (
            <StatusBadge value={mapGateTone(policy.severityGate)} label={`Block on ${policy.severityGate}`} />
          ) : (
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Advisory Only</span>
          )}

          {policy.requireEvidencePack ? (
            <span className="rounded-sm bg-info-surface px-1.5 py-0.5 text-xs text-info">Evidence Pack Enforced</span>
          ) : null}

          {policy.requireExternalReview ? (
            <span className="rounded-sm bg-warning-surface px-1.5 py-0.5 text-xs text-warning">
              External Sign-Off Required
            </span>
          ) : null}
        </div>

        {policy.requiredRoles.length > 0 ? (
          <div className="mt-3">
            <span className="text-xs text-muted-foreground">Required Roles:</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {policy.requiredRoles.map((role) => (
                <span key={role} className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  Role: {role}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {policy.requiredChecklist.length > 0 ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Verification Checklist ({policy.requiredChecklist.length} items)
            </summary>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {policy.requiredChecklist.map((chk) => (
                <li key={chk} className="flex items-center gap-2">
                  <span className="text-success">✓</span>
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
  /** Set while editing an existing policy; scope is fixed then, because PATCH cannot move one. */
  readonly editingId: string | null;
  readonly onChange: (next: DraftPolicyState) => void;
  readonly onSubmit: (event: React.FormEvent) => void;
  readonly onClose: () => void;
}

function PolicyBuilderForm({ draft, submitting, editingId, onChange, onSubmit, onClose }: PolicyBuilderProps) {
  const submitLabel = editingId ? "Update Policy" : "Save Policy";
  const roleTags = draft.requiredRoles
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const checklistTags = draft.requiredChecklist
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const labelClass = "text-sm font-medium text-foreground";

  return (
    <Panel
      title={editingId ? "Edit Governance Policy" : "Create Governance Policy"}
      description="Define release blocking criteria, required approvers, and verification checks."
      tone="raised"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
            <legend className="px-1 text-xs font-bold uppercase text-muted-foreground">1. Scope & Identity</legend>
            <div>
              <label htmlFor="policy-scope" className={labelClass}>
                Governance Scope *
              </label>
              <NativeSelect
                id="policy-scope"
                value={draft.scope}
                onChange={(e) => onChange({ ...draft, scope: e.target.value as PolicyRecord["scope"] })}
                className="mt-1"
              >
                <option value="organization">Organization (Global baseline for all repositories)</option>
                <option value="team">Team (Applies to all repositories owned by a team)</option>
                <option value="repository">Repository (Specific hardware board repository)</option>
              </NativeSelect>
            </div>

            {draft.scope !== "organization" ? (
              <div>
                <label htmlFor="policy-scope-id" className={labelClass}>
                  {draft.scope === "team" ? "Team Identifier *" : "Repository Path / ID *"}
                </label>
                <Input
                  id="policy-scope-id"
                  value={draft.scopeId}
                  onChange={(e) => onChange({ ...draft, scopeId: e.target.value })}
                  placeholder={draft.scope === "team" ? "e.g. rf-engineering" : "e.g. acme/power-distribution"}
                  className="mt-1"
                  required
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  {draft.scope === "team"
                    ? "Slug or name of the engineering team"
                    : "Full repository name or identifier"}
                </span>
              </div>
            ) : null}

            <div>
              <label htmlFor="policy-name" className={labelClass}>
                Policy Name *
              </label>
              <Input
                id="policy-name"
                value={draft.name}
                onChange={(e) => onChange({ ...draft, name: e.target.value })}
                placeholder="e.g. High-Voltage Creepage & Clearance Gate"
                className="mt-1"
                required
              />
            </div>

            <div>
              <label htmlFor="policy-desc" className={labelClass}>
                Policy Description
              </label>
              <Textarea
                id="policy-desc"
                value={draft.description}
                onChange={(e) => onChange({ ...draft, description: e.target.value })}
                placeholder="Describe the safety, fabrication, or quality purpose of this policy..."
                className="mt-1"
                rows={2}
              />
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
            <legend className="px-1 text-xs font-bold uppercase text-muted-foreground">
              2. Severity Gate & Approvers
            </legend>
            <div>
              <label htmlFor="policy-gate" className={labelClass}>
                Minimum Severity Gate (Blocks Release)
              </label>
              <NativeSelect
                id="policy-gate"
                value={draft.severityGate}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    severityGate: (e.target.value || "") as DraftPolicyState["severityGate"],
                  })
                }
                className="mt-1"
              >
                <option value="">None (Advisory only)</option>
                <option value="error">Block on Critical & Error findings (Recommended)</option>
                <option value="high">Block on High, Critical & Error findings</option>
                <option value="medium">Block on Medium and higher findings</option>
              </NativeSelect>
            </div>

            <div>
              <label htmlFor="policy-roles" className={labelClass}>
                Required Approver Roles (Comma-separated)
              </label>
              <Input
                id="policy-roles"
                value={draft.requiredRoles}
                onChange={(e) => onChange({ ...draft, requiredRoles: e.target.value })}
                placeholder="e.g. hardware-lead, compliance, rf-specialist"
                className="mt-1"
              />
              {roleTags.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {roleTags.map((r) => (
                    <span key={r} className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      Role: {r}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="mt-1 block text-xs text-muted-foreground">
                  Design sign-offs require approval from designated roles.
                </span>
              )}
            </div>

            <div>
              <label htmlFor="policy-checklist" className={labelClass}>
                Required Verification Checklist Items (Comma-separated)
              </label>
              <Input
                id="policy-checklist"
                value={draft.requiredChecklist}
                onChange={(e) => onChange({ ...draft, requiredChecklist: e.target.value })}
                placeholder="e.g. DFM review confirmed, High-voltage clearance >= 1.5mm"
                className="mt-1"
              />
              {checklistTags.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {checklistTags.map((c) => (
                    <span key={c} className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      Check: {c}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="mt-1 block text-xs text-muted-foreground">
                  Reviewers must check off these items before sign-off passes.
                </span>
              )}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
            <legend className="px-1 text-xs font-bold uppercase text-muted-foreground">
              3. Compliance & Evidence Pack
            </legend>
            <div className="flex flex-col gap-2">
              <div
                className={`flex items-start gap-2 rounded-md border p-3 ${draft.requireEvidencePack ? "border-primary bg-primary/10" : "border-border"}`}
              >
                <Input
                  id="chk-require-evidence-pack"
                  type="checkbox"
                  checked={draft.requireEvidencePack}
                  onChange={(e) => onChange({ ...draft, requireEvidencePack: e.target.checked })}
                  className="mt-0.5"
                />
                <label htmlFor="chk-require-evidence-pack" className="text-sm">
                  <strong className="font-medium text-foreground">Require Verified Evidence Pack</strong>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Mandates verified evidence digests bound to CAD DRC/ERC reports, BOM snapshots, and release
                    manifests.
                  </p>
                </label>
              </div>

              <div
                className={`flex items-start gap-2 rounded-md border p-3 ${draft.requireExternalReview ? "border-primary bg-primary/10" : "border-border"}`}
              >
                <Input
                  id="chk-require-external-review"
                  type="checkbox"
                  checked={draft.requireExternalReview}
                  onChange={(e) => onChange({ ...draft, requireExternalReview: e.target.checked })}
                  className="mt-0.5"
                />
                <label htmlFor="chk-require-external-review" className="text-sm">
                  <strong className="font-medium text-foreground">Require External / Third-Party Review</strong>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Mandates external partner, lab, or customer sign-off before manufacturing gate is unlocked.
                  </p>
                </label>
              </div>
            </div>
          </fieldset>
        </div>

        <footer className="policy-builder-footer flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving Policy…" : submitLabel}
          </Button>
        </footer>
      </form>
    </Panel>
  );
}

function PolicyInheritanceDiagram() {
  return (
    <section className="rounded-md border border-border bg-muted p-4" aria-label="Policy inheritance hierarchy">
      <h3 className="text-base font-bold text-foreground">Policy Hierarchy & Scope Resolution</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        BoardReadyOps resolves governance rules top-down with strict inheritance. Repositories inherit organization and
        team baselines. Stricter rules apply automatically; exceptions require formal review waivers.
      </p>
      <div className="mt-4 grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="rounded-md border border-border bg-card p-3">
          <div className="text-xs uppercase text-muted-foreground">Level 1: Global</div>
          <h4 className="text-sm font-bold text-foreground">Organization</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Baseline severity gates, mandatory DFM checks, and global sign-off requirements.
          </p>
        </div>
        <div className="hidden text-center text-muted-foreground sm:block" aria-hidden="true">
          →
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <div className="text-xs uppercase text-muted-foreground">Level 2: Domain</div>
          <h4 className="text-sm font-bold text-foreground">Team Scope</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Domain-specific criteria (e.g. RF impedance, automotive isolation, power rail integrity).
          </p>
        </div>
        <div className="hidden text-center text-muted-foreground sm:block" aria-hidden="true">
          →
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <div className="text-xs uppercase text-muted-foreground">Level 3: Project</div>
          <h4 className="text-sm font-bold text-foreground">Repository</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Per-board tighter tolerances, stackup layer count rules, and custom verification checklists.
          </p>
        </div>
        <div className="hidden text-center text-muted-foreground sm:block" aria-hidden="true">
          →
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <div className="text-xs uppercase text-muted-foreground">Level 4: Waiver</div>
          <h4 className="text-sm font-bold text-foreground">Review Exception</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Time-bound, break-glass sign-offs and auditable risk acceptances.
          </p>
        </div>
      </div>
    </section>
  );
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Where a draft is sent and what it carries.
 *
 * PATCH cannot move a policy between scopes, so an edit omits `scope`/`scopeId` rather than
 * sending values the endpoint would ignore, and sends explicit nulls for the two clearable
 * fields so emptying them actually empties them.
 */
function policyRequest(
  draft: DraftPolicyState,
  editingId: string | null,
): { url: string; method: "PATCH" | "POST"; body: Record<string, unknown> } {
  const mutable = {
    name: draft.name.trim(),
    requiredChecklist: splitList(draft.requiredChecklist),
    requiredRoles: splitList(draft.requiredRoles),
    requireEvidencePack: draft.requireEvidencePack,
    requireExternalReview: draft.requireExternalReview,
  };

  if (editingId) {
    return {
      url: `/api/v1/policies/${editingId}`,
      method: "PATCH",
      body: {
        ...mutable,
        description: draft.description.trim() || null,
        severityGate: draft.severityGate || null,
      },
    };
  }

  return {
    url: "/api/v1/policies",
    method: "POST",
    body: {
      ...mutable,
      scope: draft.scope,
      scopeId: draft.scope === "organization" ? undefined : draft.scopeId.trim() || undefined,
      description: draft.description.trim() || undefined,
      severityGate: draft.severityGate || undefined,
    },
  };
}

function policyOutcomeMessage(draft: DraftPolicyState, editingId: string | null): string {
  if (editingId) return `Policy "${draft.name}" updated.`;
  if (draft.severityGate) return `Policy "${draft.name}" created and enforced.`;
  return `Policy "${draft.name}" created (advisory only — no severity gate configured).`;
}

export default function PoliciesClient({ storageConfigured = true }: Readonly<{ storageConfigured?: boolean }>) {
  const [policies, setPolicies] = useState<PolicyRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftPolicyState>(emptyDraft);
  const [submitting, setSubmitting] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const loadPolicies = useCallback(async () => {
    if (!storageConfigured) {
      setPolicies([]);
      setError("This deployment has no policy storage configured, so no governance policies can be loaded or saved.");
      return;
    }
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
  }, [storageConfigured]);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  function startEditing(policy: PolicyRecord) {
    setEditingId(policy.id);
    setShowBuilder(true);
    setError(null);
    setSuccessMessage(null);
    setDraft({
      scope: policy.scope,
      scopeId: policy.scopeId ?? "",
      name: policy.name,
      description: policy.description ?? "",
      requiredChecklist: policy.requiredChecklist.join(", "),
      requiredRoles: policy.requiredRoles.join(", "),
      severityGate: policy.severityGate ?? "",
      requireEvidencePack: policy.requireEvidencePack,
      requireExternalReview: policy.requireExternalReview,
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || submitting) return;

    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    const verb = editingId ? "update" : "create";
    const request = policyRequest(draft, editingId);

    try {
      const res = await fetch(request.url, {
        method: request.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request.body),
      });
      const body = (await res.json().catch(() => ({}))) as { ok: boolean; policy?: PolicyRecord; error?: string };

      if (!res.ok || !body.ok || !body.policy) {
        setError(body.error || `Failed to ${verb} policy (${res.status})`);
        setSubmitting(false);
        return;
      }

      setSuccessMessage(policyOutcomeMessage(draft, editingId));
      setDraft(emptyDraft);
      setEditingId(null);
      setShowBuilder(false);
      await loadPolicies();
    } catch (err) {
      const networkFailure = `Network error ${verb === "update" ? "updating" : "creating"} policy`;
      setError(err instanceof Error ? err.message : networkFailure);
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

  async function confirmDelete() {
    if (!pendingDelete) return;
    const { id, name } = pendingDelete;
    setPendingDelete(null);
    await handleDelete(id, name);
  }

  function closeBuilder() {
    setShowBuilder(false);
    setEditingId(null);
    setDraft(emptyDraft);
  }

  const scopeSummary = summarizeScope(policies ?? []);
  const enforcementSummary = summarizeEnforcement(policies ?? []);

  return (
    <div className="flex flex-col gap-5">
      <PolicyInheritanceDiagram />

      <section
        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3"
        aria-label="Policies summary and actions"
      >
        <div className="flex flex-wrap gap-4 text-sm">
          <span>
            <strong>{policies?.length ?? 0}</strong> Active Policies
          </span>
          <span>
            Scope: <strong>{scopeSummary}</strong>
          </span>
          <span>
            Enforcement: <strong>{enforcementSummary}</strong>
          </span>
        </div>
        <Button
          type="button"
          variant={showBuilder ? "secondary" : "default"}
          onClick={() => {
            if (showBuilder) {
              closeBuilder();
            } else {
              setShowBuilder(true);
            }
            setError(null);
            setSuccessMessage(null);
          }}
        >
          {showBuilder ? "✕ Close Policy Builder" : "+ New Governance Policy"}
        </Button>
      </section>

      {error ? (
        <div
          className="rounded-md border border-danger/40 bg-danger-surface px-4 py-3 text-sm text-danger"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {successMessage ? (
        <output className="rounded-md border border-success/40 bg-success-surface px-4 py-3 text-sm text-success">
          ✓ {successMessage}
        </output>
      ) : null}

      {showBuilder ? (
        <PolicyBuilderForm
          draft={draft}
          submitting={submitting}
          editingId={editingId}
          onChange={setDraft}
          onSubmit={handleSubmit}
          onClose={closeBuilder}
        />
      ) : null}

      <section aria-label="Active governance policies">
        <header>
          <h2 className="text-lg font-bold text-foreground">Active Governance Policies</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Rules currently enforced on all hardware pull requests and release sign-offs.
          </p>
        </header>

        {policies === null ? (
          <div className="mt-3 rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            Loading governance policies…
          </div>
        ) : policies.length === 0 ? (
          <div className="mt-3">
            <Panel title="No Policies Configured">
              <EmptyState
                title="No governance policies configured yet"
                action={
                  <Button type="button" onClick={() => setShowBuilder(true)}>
                    + New Governance Policy
                  </Button>
                }
              >
                <p>
                  Hardware reviews currently use default open policy behavior. Creating a policy enables explicit
                  release gates, required approver roles, and mandatory verification checklists.
                </p>
              </EmptyState>
            </Panel>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {policies.map((policy) => (
              <PolicyCard
                key={policy.id}
                policy={policy}
                onEdit={startEditing}
                onDelete={(id, name) => setPendingDelete({ id, name })}
              />
            ))}
          </div>
        )}
      </section>

      {pendingDelete ? (
        <Dialog titleId="delete-policy-title" onClose={() => setPendingDelete(null)}>
          <header className="flex items-center justify-between border-b border-border p-4">
            <h2 id="delete-policy-title" className="text-base font-bold text-foreground">
              Delete Policy
            </h2>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setPendingDelete(null)}
              aria-label="Close modal"
            >
              ✕
            </button>
          </header>
          <div className="p-4 text-sm text-foreground">
            <p>
              Delete <strong>{pendingDelete.name}</strong>? This removes it from enforcement immediately — hardware
              reviews currently gated by this policy will no longer be blocked by it.
            </p>
          </div>
          <footer className="modal-footer flex items-center justify-end gap-2 border-t border-border p-4">
            <Button type="button" variant="secondary" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDelete()}>
              Delete Policy
            </Button>
          </footer>
        </Dialog>
      ) : null}
    </div>
  );
}
