import type { LegalHold } from "@boardreadyops/db";
import Link from "next/link";
import {
  LegalHoldCreateForm,
  LegalHoldReleaseButton,
  RetentionPolicyForm,
} from "../../../components/settings/data-admin-forms.js";
import { ErasureRequestForm, ExportRequestForm } from "../../../components/settings/data-lifecycle-forms.js";
import { Button } from "../../../components/ui/button.js";
import { NativeSelect } from "../../../components/ui/native-select.js";
import { Alert, EmptyState, Panel, StatusBadge } from "../../../components/ui.js";
import { loadDataSettingsAdmin, retentionPolicyForInstallation } from "../../../lib/data-settings-admin.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";
import {
  createLegalHoldAction,
  releaseLegalHoldAction,
  requestErasureAction,
  requestExportAction,
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

function customizableRetention(planTier: string): boolean {
  return ["business", "pilot", "enterprise"].includes(planTier.trim().toLowerCase());
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

export default async function DataSettingsPage({ searchParams }: Readonly<DataSettingsPageProps>) {
  const parameters = await searchParams;
  const viewer = await viewerAuthorization();
  const admin = await loadDataSettingsAdmin(viewer.session, first(parameters.installation));

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Data & Retention"
        description="Retention policy, legal holds, exports, and erasure in one place."
        id="retention"
      >
        <p className="text-sm text-muted-foreground">
          Free keeps evidence for 30 days, Team for 365 days, and Business/Pilot can choose a custom window or retain
          indefinitely. Raw component-provider data remains capped at 24 hours.
        </p>
      </Panel>

      {admin.state === "signed-out" ? (
        <Panel title="Retention policy and legal holds">
          <EmptyState title="Sign in to administer data policy">
            <Button asChild className="mt-3">
              <a href="/api/auth/github/login">Sign in with GitHub</a>
            </Button>
          </EmptyState>
        </Panel>
      ) : admin.state === "no-installations" ? (
        <Panel title="Retention policy and legal holds">
          <EmptyState title="Install BoardReadyOps first">
            <p>Data policy belongs to a GitHub App installation. Complete setup, then return here.</p>
            <Button asChild className="mt-3">
              <Link href="/setup">Go to Setup</Link>
            </Button>
          </EmptyState>
        </Panel>
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
              return (
                <>
                  <dl className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <dt className="text-meta uppercase tracking-wide text-muted-foreground">Plan</dt>
                      <dd className="mt-1 text-sm font-medium text-foreground">{admin.selected.planTier}</dd>
                    </div>
                    <div>
                      <dt className="text-meta uppercase tracking-wide text-muted-foreground">Evidence retention</dt>
                      <dd className="mt-1 text-sm font-medium text-foreground">
                        {retentionDays === null ? "Indefinite" : `${retentionDays} days`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-meta uppercase tracking-wide text-muted-foreground">Source retention</dt>
                      <dd className="mt-1 text-sm font-medium text-foreground">24 hours</dd>
                    </div>
                  </dl>
                  <RetentionPolicyForm
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
            title="Legal holds"
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
            <LegalHoldCreateForm installationId={admin.selected.id} action={createLegalHoldAction} />
          </Panel>
        </>
      )}

      {admin.state === "ok" ? (
        <>
          <Panel
            title="Export your data"
            description={`Requests a signed pack of records under ${admin.selected.accountLogin}.`}
          >
            <ExportRequestForm installationId={admin.selected.id} action={requestExportAction} />
          </Panel>
          <Panel
            title="Erasure request"
            description="Removes records for a scope. An active legal hold blocks it."
            tone="critical"
          >
            <ErasureRequestForm
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
