import { Button } from "../../../components/ui/button.js";
import { EmptyState, Panel, StatusBadge } from "../../../components/ui.js";
import { securitySettingsReadiness } from "../../../lib/security-settings-readiness.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";

export const metadata = { title: "Security & Access" };
export const dynamic = "force-dynamic";

function stateLabel(configured: boolean): string {
  return configured ? "Configured" : "Missing";
}

export default async function SecuritySettingsPage() {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return (
      <Panel title="Security & Access">
        <EmptyState title="Sign in to review security readiness">
          <p>Deployment security details are available only to authenticated operators.</p>
          <Button asChild className="mt-3">
            <a href="/api/auth/github/login">Sign in with GitHub</a>
          </Button>
        </EmptyState>
      </Panel>
    );
  }

  const readiness = securitySettingsReadiness();
  const githubReady =
    readiness.githubApp.appIdConfigured &&
    readiness.githubApp.privateKeyConfigured &&
    readiness.githubApp.webhookSecretConfigured;
  return (
    <div className="flex flex-col gap-5">
      <Panel title="Security & Access" description="Deployment trust controls, without exposing secret material.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">Session protection</h3>
            <StatusBadge
              value={readiness.sessionSigning.configured ? "success" : "warning"}
              label={stateLabel(readiness.sessionSigning.configured)}
            />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Persistence</h3>
            <StatusBadge
              value={readiness.persistence.configured ? "success" : "warning"}
              label={stateLabel(readiness.persistence.configured)}
            />
          </div>
          <div>
            <h3 className="text-sm font-semibold">GitHub App trust</h3>
            <StatusBadge value={githubReady ? "success" : "warning"} label={stateLabel(githubReady)} />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Credential encryption</h3>
            <StatusBadge
              value={readiness.credentialEncryption.configured ? "success" : "warning"}
              label={stateLabel(readiness.credentialEncryption.configured)}
            />
          </div>
        </div>
      </Panel>

      <Panel
        title="Enterprise SSO"
        description="SAML metadata is visible here; certificates and keys remain operator-managed and are never rendered."
      >
        <StatusBadge
          value={
            readiness.saml.state === "configured"
              ? "success"
              : readiness.saml.state === "incomplete"
                ? "warning"
                : "neutral"
          }
          label={readiness.saml.state}
        />
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-meta text-muted-foreground">Entity ID</dt>
            <dd className="break-all text-sm">{readiness.saml.entityId ?? "Not configured"}</dd>
          </div>
          <div>
            <dt className="text-meta text-muted-foreground">ACS URL</dt>
            <dd className="break-all text-sm">{readiness.saml.acsUrl ?? "Not configured"}</dd>
          </div>
          <div>
            <dt className="text-meta text-muted-foreground">IdP metadata</dt>
            <dd className="break-all text-sm">
              {readiness.saml.metadataConfigured
                ? readiness.saml.idpMetadataHost
                  ? `Configured (${readiness.saml.idpMetadataHost})`
                  : "Configured"
                : "Not configured"}
            </dd>
          </div>
          <div>
            <dt className="text-meta text-muted-foreground">Signing certificate</dt>
            <dd className="text-sm">{stateLabel(readiness.saml.certificateConfigured)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-meta text-muted-foreground">
          Operator-managed: change SAML secret material through the deployment secret manager and redeploy.
        </p>
      </Panel>

      <Panel
        title="SCIM provisioning"
        description="Automated identity lifecycle is not active in the production runtime yet."
      >
        <StatusBadge value="neutral" label="Planned" />
        <p className="mt-3 text-sm text-muted-foreground">
          No SCIM endpoint or bearer credential is advertised until provisioning is production-wired. Workspace
          membership and API-token controls remain the enforceable access paths today.
        </p>
      </Panel>
    </div>
  );
}
