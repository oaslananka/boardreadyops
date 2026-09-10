import Link from "next/link";
import { Button } from "../../../components/ui/button.js";
import { EmptyState, Panel, StatusBadge } from "../../../components/ui.js";
import { loadIntegrationHealth } from "../../../lib/integration-health.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";

export const metadata = { title: "Integrations & Health" };
export const dynamic = "force-dynamic";

function badgeValue(value: string): string {
  if (["healthy", "connected", "configured"].includes(value)) return "ready";
  if (["degraded", "rejected", "offline"].includes(value)) return "warning";
  return value === "not_configured" ? "missing" : value;
}

export default async function IntegrationsSettingsPage() {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return (
      <Panel title="Integrations & Health">
        <EmptyState title="Sign in to inspect integration health">
          <Button asChild className="mt-3">
            <a href="/api/auth/github/login">Sign in with GitHub</a>
          </Button>
        </EmptyState>
      </Panel>
    );
  }

  const result = await loadIntegrationHealth(viewer.session);
  if (result.state === "unavailable") {
    return (
      <Panel title="Integrations & Health">
        <EmptyState title="Health data is temporarily unavailable">
          <p>{result.reason}</p>
        </EmptyState>
      </Panel>
    );
  }

  const { snapshot } = result;
  return (
    <div className="flex flex-col gap-5">
      <Panel title="Deployment readiness" description="Live control-plane configuration and database readiness.">
        <StatusBadge value={badgeValue(snapshot.deployment.status)} label={snapshot.deployment.status} />
        {snapshot.deployment.reason ? (
          <p className="mt-2 text-meta text-muted-foreground">{snapshot.deployment.reason}</p>
        ) : null}
      </Panel>

      {snapshot.installations.length === 0 ? (
        <Panel title="GitHub App">
          <EmptyState title="No active installations">
            <p>Install the GitHub App, then return here to see repository and runner health.</p>
            <Button asChild className="mt-3">
              <Link href="/setup">Go to Setup</Link>
            </Button>
          </EmptyState>
        </Panel>
      ) : (
        snapshot.installations.map((installation) => (
          <Panel key={installation.id} title={installation.accountLogin} description={`Plan: ${installation.planTier}`}>
            <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <dt className="text-meta font-medium text-muted-foreground">GitHub App</dt>
                <dd className="mt-1">
                  <StatusBadge value="ready" label="Connected" />
                </dd>
              </div>
              <div>
                <dt className="text-meta font-medium text-muted-foreground">Repository setup</dt>
                <dd className="mt-1 text-sm">
                  {installation.repositories.ready}/{installation.repositories.total} ready ·{" "}
                  {installation.repositories.attention} attention · {installation.repositories.unconfigured}{" "}
                  unconfigured
                </dd>
              </div>
              <div>
                <dt className="text-meta font-medium text-muted-foreground">Component intelligence</dt>
                <dd className="mt-1">
                  <StatusBadge
                    value={badgeValue(installation.componentIntelligence)}
                    label={installation.componentIntelligence.replaceAll("_", " ")}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-meta font-medium text-muted-foreground">Runner fleet</dt>
                <dd className="mt-1">
                  <StatusBadge
                    value={badgeValue(installation.runner.status)}
                    label={installation.runner.status.replaceAll("_", " ")}
                  />
                  <span className="ml-2 text-meta text-muted-foreground">
                    {installation.runner.online}/{installation.runner.active} online · {installation.runner.pendingJobs}{" "}
                    queued
                  </span>
                </dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/setup">Review setup</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/settings/component-intelligence">Component credentials</Link>
              </Button>
            </div>
          </Panel>
        ))
      )}
    </div>
  );
}
