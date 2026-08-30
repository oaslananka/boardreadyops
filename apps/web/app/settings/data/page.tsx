import { DATA_RETENTION_DEFAULTS } from "@boardreadyops/cloud-core/data-retention-defaults";

const noAutomaticExpiry = "No automatic age-based expiry";

export default function DataSettingsPage() {
  const artifactDefaults = DATA_RETENTION_DEFAULTS.managedArtifactDaysByPlan;
  return (
    <div className="panel">
      <header className="panel-header">
        <div>
          <h1>Data & Retention</h1>
          <p>
            Current lifecycle defaults by data class. Managed-artifact expiry preview is suppressed by active tenant
            legal holds.
          </p>
        </div>
      </header>
      <dl className="definition-grid">
        <div>
          <dt>Webhook terminal metadata</dt>
          <dd>{DATA_RETENTION_DEFAULTS.webhookInboxDays} days</dd>
        </div>
        <div>
          <dt>Terminal one-time records</dt>
          <dd>{DATA_RETENTION_DEFAULTS.terminalEphemeralRecordDays} days</dd>
        </div>
        <div>
          <dt>Completed delivery & reconciliation history</dt>
          <dd>{DATA_RETENTION_DEFAULTS.completedControlPlaneHistoryDays} days</dd>
        </div>
        <div>
          <dt>Managed artifacts</dt>
          <dd>
            Free {artifactDefaults.free} days; Team {artifactDefaults.team} days; Business/Enterprise explicit policy
          </dd>
        </div>
        <div>
          <dt>Logical runs & findings</dt>
          <dd>{noAutomaticExpiry}</dd>
        </div>
        <div>
          <dt>Audit events</dt>
          <dd>{noAutomaticExpiry}; append-only evidence</dd>
        </div>
        <div>
          <dt>Source workspaces</dt>
          <dd>Not retained by the control plane; GitHub or the customer runner remains the source boundary</dd>
        </div>
      </dl>
      <p className="cell-note">
        Physical age-based artifact deletion remains disabled. Artifact retention is currently a read-only eligibility
        preview; erasure execution and complete uninstall/legal-hold lifecycle remain separate operator-controlled work.
      </p>
    </div>
  );
}
