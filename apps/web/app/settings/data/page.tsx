import { ErasureRequestForm, ExportRequestForm } from "../../../components/settings/data-lifecycle-forms.js";
import { Button } from "../../../components/ui/button.js";
import { EmptyState, Panel } from "../../../components/ui.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";
import { requestErasureAction, requestExportAction } from "./actions.js";

export const metadata = {
  title: "Data & Retention",
  description: "Retention tiers, data exports, and erasure requests.",
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const retentionTiers = [
  { label: "Free", value: "30 days" },
  { label: "Team", value: "365 days" },
  { label: "Business", value: "Configurable; legal hold blocks deletion" },
  { label: "Source retention", value: "24 hours after job (derived snapshots follow plan retention)" },
] as const;

export default async function DataSettingsPage() {
  const viewer = await viewerAuthorization();

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Data & Retention" description="How long BoardReadyOps keeps what, per plan tier." id="retention">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {retentionTiers.map((tier) => (
            <div key={tier.label}>
              <dt className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{tier.label}</dt>
              <dd className="mt-1 text-sm text-foreground">{tier.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-meta text-muted-foreground">
          Uninstall gives a 30-day export window; immediate delete or a legal hold can override it. Exports are async,
          signed, and time-limited.
        </p>
      </Panel>

      {viewer.session ? (
        <>
          <Panel
            title="Export your data"
            description="Requests a signed pack of the records BoardReadyOps holds for the scope you choose."
          >
            <ExportRequestForm action={requestExportAction} />
          </Panel>

          <Panel
            title="Erasure request"
            description="Removes the records for a scope. An active legal hold blocks it."
            tone="critical"
          >
            <ErasureRequestForm action={requestErasureAction} defaultScopeLabel={viewer.session.login} />
          </Panel>
        </>
      ) : (
        <Panel title="Exports and erasure">
          <EmptyState title="Sign in to request an export or erasure">
            <p>Both are scoped to your own tenant, so BoardReadyOps needs to know who is asking.</p>
            <Button asChild className="mt-3">
              <a href="/api/auth/github/login">Sign in with GitHub</a>
            </Button>
          </EmptyState>
        </Panel>
      )}
    </div>
  );
}
