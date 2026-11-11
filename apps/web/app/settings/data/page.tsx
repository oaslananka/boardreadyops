import type { LegalHold, VerifiedHistoricalUserExportReceipt } from "@boardreadyops/db";
import Link from "next/link";
import {
  LegalHoldCreateForm,
  LegalHoldReleaseButton,
  RepositoryRetentionPolicyForm,
  RetentionPolicyForm,
} from "../../../components/settings/data-admin-forms.js";
import { ErasureRequestForm, ExportRequestForm } from "../../../components/settings/data-lifecycle-forms.js";
import { ExportRequestReceipt } from "../../../components/settings/export-request-receipt.js";
import { Button } from "../../../components/ui/button.js";
import { NativeSelect } from "../../../components/ui/native-select.js";
import { Alert, EmptyState, Panel, StatusBadge } from "../../../components/ui.js";
import { resolveControlPlaneRetentionConfiguration } from "../../../lib/cloud-runtime-config.js";
import { customerPlanLabel, customerStatusLabel } from "../../../lib/customer-nomenclature.js";
import {
  customizableRetention,
  loadDataSettingsAdmin,
  retentionPolicyForInstallation,
} from "../../../lib/data-settings-admin.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";
import {
  createLegalHoldAction,
  releaseLegalHoldAction,
  requestErasureAction,
  requestExportAction,
  saveRepositoryRetentionPolicyAction,
  saveRetentionPolicyAction,
} from "./actions.js";

export const metadata = {
  title: "Data & Retention",
  description: "Retention policies, legal holds, data exports, and erasure requests.",
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DataSettingsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function InstallationSelector({
  installations,
  selectedId,
}: Readonly<{ installations: readonly { id: string; accountLogin: string }[]; selectedId: string }>) {
  if (installations.length <= 1) return null;
  return (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="data-settings-installation" className="text-meta font-medium text-foreground">
          Installation
        </label>
        <NativeSelect id="data-settings-installation" name="installation" defaultValue={selectedId}>
          {installations.map((installation) => (
            <option key={installation.id} value={installation.id}>
              {installation.accountLogin}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" variant="outline" size="sm">
        Show
      </Button>
    </form>
  );
}

function HoldRow({ hold, installationId }: Readonly<{ hold: LegalHold; installationId: string }>) {
  const target = hold.scopeId ? `${hold.scope}: ${hold.scopeId}` : hold.scope;
  return (
    <li className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge value={hold.active ? "warning" : "neutral"} label={hold.active ? "Active" : "Released"} />
          <span className="font-mono text-meta text-muted-foreground">{target}</span>
        </div>
        <p className="mt-2 text-sm text-foreground">{hold.reason}</p>
        <p className="mt-1 text-meta text-muted-foreground">
          Created by {hold.createdBy} on {hold.createdAt.slice(0, 10)}
          {hold.releasedBy ? ` · released by ${hold.releasedBy}` : ""}
        </p>
      </div>
      {hold.active ? (
        <LegalHoldReleaseButton
          installationId={installationId}
          holdId={hold.id}
          reason={hold.reason}
          action={releaseLegalHoldAction}
        />
      ) : null}
    </li>
  );
}

function HistoricalUserExportHistory({
  requests,
  historyUnavailable,
}: Readonly<{
  requests: readonly VerifiedHistoricalUserExportReceipt[];
  historyUnavailable: boolean;
}>) {
  return (
    <Panel
      title="Past personal-account export requests"
      description="Statuses for requests tied to your original GitHub user identity, even after uninstall."
    >
      {historyUnavailable ? (
        <Alert tone="warning" title="Historical request status unavailable">
          Your historical request status cannot be checked right now. Your data was not changed.
        </Alert>
      ) : requests.length === 0 ? (
        <EmptyState title="No personal uninstall requests found">
          <p>No still-eligible historical USER export requests belong to this signed-in GitHub account.</p>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {requests.map((request) => (
            <li key={request.exportId} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <time dateTime={request.createdAt}>{request.createdAt.slice(0, 10)}</time>
                <span className="font-medium">{customerStatusLabel(request.status)}</span>
              </div>
              <p className="mt-2 break-all font-mono text-meta text-muted-foreground">Reference: {request.exportId}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        No downloadable customer archive is available through this status history. An export request is not confirmation
        that all customer data has been delivered. Organization uninstall requests are not user-scoped recovery
        requests.
      </p>
      <Link href="/settings/data" className="mt-3 inline-block text-sm text-primary underline underline-offset-2">
        Refresh request statuses
      </Link>
    </Panel>
  );
}

export default async function DataSettingsPage({ searchParams }: Readonly<DataSettingsPageProps>) {
  const parameters = await searchParams;
  const viewer = await viewerAuthorization();
  const admin = await loadDataSettingsAdmin(viewer.session, first(parameters.installation));
  const controlPlaneRetention = resolveControlPlaneRetentionConfiguration();

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Data & Retention"
        description="Retention policy, legal holds, exports, and erasure in one place."
        id="retention"
      >
        <p className="text-sm text-muted-foreground">
          Free keeps managed artifacts for 30 days, Team for 365 days, and Business/Pilot/Enterprise can choose a custom
          window or retain indefinitely. Component-provider source cache follows the effective installation policy shown
          below.
        </p>
      </Panel>

      <Panel
        title="Control-plane lifecycle defaults"
        description="Deployment-level windows that apply independently of tenant managed-artifact retention."
      >
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-meta uppercase tracking-wide text-muted-foreground">Webhook terminal metadata</dt>
            <dd className="mt-1 text-sm font-medium text-foreground">{controlPlaneRetention.webhookInboxDays} days</dd>
          </div>
          <div>
            <dt className="text-meta uppercase tracking-wide text-muted-foreground">One-time control-plane records</dt>
            <dd className="mt-1 text-sm font-medium text-foreground">
              {controlPlaneRetention.ephemeralRecordsDays} days
            </dd>
          </div>
          <div>
            <dt className="text-meta uppercase tracking-wide text-muted-foreground">Completed delivery history</dt>
            <dd className="mt-1 text-sm font-medium text-foreground">
              {controlPlaneRetention.controlPlaneHistoryDays} days
            </dd>
          </div>
          <div>
            <dt className="text-meta uppercase tracking-wide text-muted-foreground">Runs, findings & audit events</dt>
            <dd className="mt-1 text-sm font-medium text-foreground">No automatic age-based purge</dd>
          </div>
        </dl>
        <p className="mt-3 text-meta text-muted-foreground">
          These are operator-managed deployment settings. The tenant-scoped managed-artifact policy below controls
          report-object expiry separately.
        </p>
      </Panel>

      {admin.state === "signed-out" ? (
        <Panel title="Retention policy and legal holds">
          <EmptyState title="Sign in to administer data policy">
            <p>
              Use your original GitHub account to check the status of a past personal-account uninstall request, even if
              you no longer have an active App installation.
            </p>
            <Button asChild className="mt-3">
              <a href="/api/auth/github/login?return_to=%2Fsettings%2Fdata">Sign in with GitHub</a>
            </Button>
          </EmptyState>
        </Panel>
      ) : admin.state === "no-installations" ? (
        <>
          <Panel title="Retention policy and legal holds">
            <EmptyState title="No active GitHub App installation">
              <p>
                Installation data policy requires a current GitHub App grant. If you removed a personal-account
                installation, check its historical export status below.
              </p>
              <Button asChild className="mt-3">
                <Link href="/setup">Go to Setup</Link>
              </Button>
            </EmptyState>
          </Panel>
          <HistoricalUserExportHistory
            requests={admin.historicalUserRequests}
            historyUnavailable={admin.historyUnavailable}
          />
        </>
      ) : admin.state === "not-authorized" ? (
        <Panel title="Retention policy and legal holds">
          <Alert tone="danger" title="Installation not available">
            The requested installation is not in your current session. Pick one you administer from Settings.
          </Alert>
        </Panel>
      ) : admin.state === "not-configured" ? (
        <Panel title="Retention policy and legal holds">
          <Alert tone="warning" title="Persistence is not configured">
            This deployment has no control-plane database, so retention policy and legal holds cannot be stored.
          </Alert>
        </Panel>
      ) : (
        <>
          <Panel
            title="Retention policy"
            description={`Applied to ${admin.selected.accountLogin}. The cleanup worker reads this same policy.`}
          >
            <InstallationSelector installations={admin.installations} selectedId={admin.selected.id} />
            {(() => {
              const planDefault = retentionPolicyForInstallation(admin.selected, undefined);
              const retentionDays = admin.policy ? admin.policy.retentionDays : planDefault.retentionDays;
              const sourceRetentionHours = admin.policy
                ? admin.policy.sourceRetentionHours
                : planDefault.sourceRetentionHours;
              return (
                <>
                  <dl className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <dt className="text-meta uppercase tracking-wide text-muted-foreground">Plan</dt>
                      <dd className="mt-1 text-sm font-medium text-foreground">
                        {customerPlanLabel(admin.selected.planTier)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-meta uppercase tracking-wide text-muted-foreground">
                        Managed artifact retention
                      </dt>
                      <dd className="mt-1 text-sm font-medium text-foreground">
                        {retentionDays === null ? "Indefinite" : `${retentionDays} days`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-meta uppercase tracking-wide text-muted-foreground">
                        Component source cache
                      </dt>
                      <dd className="mt-1 text-sm font-medium text-foreground">{sourceRetentionHours} hours</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-meta text-muted-foreground">
                    Component-provider source data for this installation is retained for up to {sourceRetentionHours}{" "}
                    hours.
                  </p>
                  <RetentionPolicyForm
                    key={admin.selected.id}
                    installationId={admin.selected.id}
                    currentRetentionDays={retentionDays}
                    customizable={customizableRetention(admin.selected.planTier)}
                    action={saveRetentionPolicyAction}
                  />
                </>
              );
            })()}
          </Panel>

          <Panel
            title="Repository retention overrides"
            description="Override managed-artifact retention for an individual repository without changing the organization default."
          >
            {customizableRetention(admin.selected.planTier) ? (
              admin.repositoryPolicies.length === 0 ? (
                <EmptyState title="No repositories available">
                  <p>Enable a repository under this installation before adding an override.</p>
                </EmptyState>
              ) : (
                <div className="flex flex-col gap-3">
                  {(() => {
                    const planDefault = retentionPolicyForInstallation(admin.selected, undefined);
                    const inheritedRetentionDays = admin.policy
                      ? admin.policy.retentionDays
                      : planDefault.retentionDays;
                    return admin.repositoryPolicies.map((repository) => (
                      <RepositoryRetentionPolicyForm
                        key={repository.repositoryId}
                        installationId={admin.selected.id}
                        repositoryId={repository.repositoryId}
                        repositoryName={`${repository.owner}/${repository.name}`}
                        hasOverride={repository.hasOverride}
                        currentRetentionDays={repository.retentionDays}
                        inheritedRetentionDays={inheritedRetentionDays}
                        action={saveRepositoryRetentionPolicyAction}
                      />
                    ));
                  })()}
                </div>
              )
            ) : (
              <p className="text-sm text-muted-foreground">
                Repository overrides are available on Business, Pilot, and Enterprise. This plan uses its fixed
                managed-artifact retention window for every repository.
              </p>
            )}
          </Panel>

          <Panel
            title="GitHub App uninstall lifecycle"
            description="What BoardReadyOps does when this installation is removed from GitHub."
            id="uninstall-lifecycle"
          >
            <ol className="grid gap-3 text-sm text-foreground">
              <li>
                <span className="font-medium">1. Access stops immediately.</span> BoardReadyOps suspends the
                installation and revokes its repository API tokens before any delayed deletion work.
              </li>
              <li>
                <span className="font-medium">2. Portability is queued.</span> One tenant-scoped export request is
                created from the persisted installation identity. Legal holds do not block export intake because
                exporting is non-destructive.
              </li>
              <li>
                <span className="font-medium">3. Destructive erasure waits 30 days.</span> One account-scoped uninstall
                erasure request is queued with a deadline 30 days after BoardReadyOps processes the uninstall. An
                applicable active legal hold changes that request to blocked by hold.
              </li>
              <li>
                <span className="font-medium">4. Reinstall preserves portability.</span> A real GitHub App reinstall
                cancels a still-active uninstall erasure request, while the paired export request remains available.
              </li>
            </ol>
            <Alert tone="warning" title="Delete-later boundary">
              Complete relational erasure, non-local managed-object deletion, backups, and platform-log expiry are not
              automatically completed by uninstall today. Operators must follow the documented retention and erasure
              procedure for those copies.
            </Alert>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <a className="text-primary underline underline-offset-2" href="#data-export">
                Request an export
              </a>
              <a className="text-primary underline underline-offset-2" href="#legal-holds">
                Manage legal holds
              </a>
              <a className="text-primary underline underline-offset-2" href="#erasure-request">
                Request erasure
              </a>
            </div>
          </Panel>

          <Panel
            title="Legal holds"
            id="legal-holds"
            description="Active holds block matching retention cleanup and erasure. Released holds stay visible for audit history."
          >
            {admin.holds.length === 0 ? (
              <EmptyState title="No legal holds">
                <p>Create one below when records must be preserved beyond normal retention.</p>
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-2">
                {admin.holds.map((hold) => (
                  <HoldRow key={hold.id} hold={hold} installationId={admin.selected.id} />
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Create legal hold"
            description={`Preserve records under ${admin.selected.accountLogin}.`}
            tone="critical"
          >
            <LegalHoldCreateForm
              key={admin.selected.id}
              installationId={admin.selected.id}
              action={createLegalHoldAction}
            />
          </Panel>
        </>
      )}

      {admin.state === "ok" ? (
        <>
          <Panel
            title="Export your data"
            id="data-export"
            description={`Records an export request for ${admin.selected.accountLogin}.`}
          >
            <p className="mb-3 text-sm text-muted-foreground">
              An export request does not create a downloadable pack automatically. An authorized operator must prepare
              and deliver an export using a separate workflow. After recording the request, you can refresh its status
              and optionally download or revoke the 15-minute metadata-only preview if an operator publishes it. If an
              operator stages a private ZIP, refresh the request to reveal a requester-only download and revoke option.
              That prepared ZIP is partial and is not confirmation of a complete customer data export.
            </p>
            <ExportRequestForm
              key={admin.selected.id}
              installationId={admin.selected.id}
              action={requestExportAction}
            />
            <div className="mt-5 border-t border-border pt-4">
              <h3 className="text-sm font-semibold">Recent export requests</h3>
              <p className="mt-1 text-meta text-muted-foreground">
                Your 10 most recent requests for this installation. Open a request to check its current status and any
                separately prepared partial ZIP.
              </p>
              {admin.recentExportRequests.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No earlier export requests from this account.</p>
              ) : (
                <ol className="mt-3 flex flex-col gap-2">
                  {admin.recentExportRequests.map((request) => (
                    <li key={request.exportId}>
                      <details className="rounded-md border border-border p-3">
                        <summary className="cursor-pointer text-sm font-medium">
                          {request.createdAt.slice(0, 10)} · {customerStatusLabel(request.status)} · #
                          {request.exportId.slice(0, 8)}
                        </summary>
                        <div className="mt-3">
                          <ExportRequestReceipt
                            key={request.exportId}
                            issued={{ exportId: request.exportId, status: request.status }}
                            installationId={admin.selected.id}
                          />
                        </div>
                      </details>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Panel>
          {admin.historicalUserRequests.length > 0 ? (
            <HistoricalUserExportHistory
              requests={admin.historicalUserRequests}
              historyUnavailable={admin.historyUnavailable}
            />
          ) : null}
          <Panel
            title="Erasure request"
            id="erasure-request"
            description="Records a scoped erasure request. An active legal hold blocks it."
            tone="critical"
          >
            <p className="mb-3 text-sm text-muted-foreground">
              Submitting an erasure request does not delete records. Completion requires a separate authorized operator
              workflow and must respect active legal holds.
            </p>
            <ErasureRequestForm
              key={admin.selected.id}
              installationId={admin.selected.id}
              action={requestErasureAction}
              defaultScopeLabel={admin.selected.accountLogin}
            />
          </Panel>
        </>
      ) : null}
    </div>
  );
}
