import { configuredCredentialCipher } from "@boardreadyops/cloud-core/credential-encryption";
import { planLimits, planTierOf } from "@boardreadyops/cloud-core/entitlements";
import Link from "next/link";
import { Alert, Definition, DefinitionGrid, EmptyState, Panel, type StatusTone } from "../../../components/ui.js";
import { nexarProviderName } from "../../../lib/component-intelligence-resolver.js";
import { issueSettingsFormToken } from "../../../lib/settings-form-token.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";
import { viewerInstallations } from "../../../lib/viewer-installations.js";

export const metadata = {
  title: "Component intelligence · BoardReadyOps",
  description: "Supply your own component data provider credentials for continuous supply watch.",
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const outcomes: Record<string, { tone: StatusTone; title: string; message: string }> = {
  saved: { tone: "success", title: "Credential saved", message: "The next supply watch pass will use it." },
  removed: { tone: "info", title: "Credential removed", message: "Supply watch will stop looking parts up." },
  incomplete: {
    tone: "warning",
    title: "Missing details",
    message: "Both the client ID and the client secret are required.",
  },
  expired: { tone: "warning", title: "Form expired", message: "Reload the page and try again." },
  forbidden: { tone: "danger", title: "Not permitted", message: "You do not have access to that installation." },
  signed_out: { tone: "warning", title: "Signed out", message: "Sign in again to change credentials." },
  invalid: { tone: "warning", title: "Invalid submission", message: "That submission was not valid." },
  unavailable: {
    tone: "danger",
    title: "Storage unavailable",
    message: "Credential storage is not configured on this deployment.",
  },
  failed: { tone: "danger", title: "Could not store", message: "The credential could not be stored. Try again." },
};

export default async function ComponentIntelligencePage({ searchParams }: PageProps) {
  const parameters = await searchParams;
  const outcome = outcomes[first(parameters.status) ?? ""];
  const viewer = await viewerAuthorization();
  const session = viewer.session;
  const cipherConfigured = configuredCredentialCipher(process.env) !== undefined;
  const installations = await viewerInstallations(session, nexarProviderName);
  const secret = process.env.SESSION_SECRET?.trim();
  const now = new Date();

  return (
    <div className="component-intelligence-settings">
      <header className="page-heading">
        <h2>Component intelligence</h2>
        <p>
          Continuous supply watch checks every part on your boards for lifecycle changes. Lookups run under{" "}
          <strong>your own provider account</strong>, not a shared BoardReadyOps subscription, because provider licences
          are non-transferable — one customer&apos;s answer may not be reused for another.
        </p>
      </header>

      {outcome ? (
        <Alert tone={outcome.tone} title={outcome.title}>
          {outcome.message}
        </Alert>
      ) : undefined}

      {!cipherConfigured ? (
        <Alert tone="danger" title="Credential storage is not configured">
          This deployment has no credential encryption key configured, so credentials cannot be stored. Set
          BOARDREADYOPS_CREDENTIAL_ENCRYPTION_KEY and redeploy.
        </Alert>
      ) : undefined}

      {!session ? (
        <Panel title="Sign in required">
          <EmptyState title="Sign in to configure component intelligence">
            <p>Credentials are stored per installation, so we need to know which installations you can administer.</p>
          </EmptyState>
        </Panel>
      ) : installations.length === 0 ? (
        <Panel title="No installations">
          <EmptyState title="No active installations found">
            <p>Install the BoardReadyOps GitHub App on an account you administer, then return here.</p>
          </EmptyState>
        </Panel>
      ) : (
        installations.map((installation) => {
          const limits = planLimits(planTierOf(installation.planTier));
          const token = secret ? issueSettingsFormToken(session, installation.id, secret, now) : "";

          return (
            <Panel key={installation.id} title={installation.accountLogin}>
              <DefinitionGrid>
                <Definition label="Plan">{installation.planTier}</Definition>
                <Definition label="Supply watch">
                  {limits.supplyWatch ? "Included" : "Not included on this plan"}
                </Definition>
                <Definition label="Credential">{installation.hasComponentCredential ? "Stored" : "Not set"}</Definition>
              </DefinitionGrid>

              {!limits.supplyWatch ? (
                <Alert tone="info" title="Supply watch is not on this plan">
                  Supply watch is not included on the {installation.planTier} plan. You can store a credential now;
                  boards will start being checked when the plan includes it.
                </Alert>
              ) : undefined}

              {installation.componentCredentialRejectedAt ? (
                <Alert tone="warning" title="The provider refused this credential">
                  Refused on {new Date(installation.componentCredentialRejectedAt).toISOString().slice(0, 10)}
                  {installation.componentCredentialRejectedReason
                    ? ` (${installation.componentCredentialRejectedReason})`
                    : ""}
                  . Replace it below; the stored credential is kept until you do, in case the refusal was temporary.
                </Alert>
              ) : undefined}

              <form action="/api/v1/settings/component-intelligence" method="post" className="settings-form">
                <input type="hidden" name="installation_id" value={installation.id} />
                <input type="hidden" name="form_token" value={token} />

                <label htmlFor={`client-id-${installation.id}`}>Nexar client ID</label>
                <input
                  id={`client-id-${installation.id}`}
                  name="client_id"
                  type="text"
                  autoComplete="off"
                  maxLength={512}
                  required
                />

                <label htmlFor={`client-secret-${installation.id}`}>Nexar client secret</label>
                {/* Never rendered back: the stored value is write-only from this page. */}
                <input
                  id={`client-secret-${installation.id}`}
                  name="client_secret"
                  type="password"
                  autoComplete="new-password"
                  maxLength={512}
                  required
                />

                <label htmlFor={`scope-${installation.id}`}>OAuth scope (optional)</label>
                <input
                  id={`scope-${installation.id}`}
                  name="scope"
                  type="text"
                  autoComplete="off"
                  maxLength={512}
                  placeholder="supply.domain"
                />

                <div className="settings-form-actions">
                  <button type="submit" name="action" value="save" disabled={!cipherConfigured}>
                    {installation.hasComponentCredential ? "Replace credential" : "Save credential"}
                  </button>
                  {/* formNoValidate: removal does not need the credential fields, and the
                        browser would otherwise block the submit on their required attribute. */}
                  {installation.hasComponentCredential ? (
                    <button type="submit" name="action" value="remove" className="secondary" formNoValidate>
                      Remove
                    </button>
                  ) : undefined}
                </div>
              </form>
            </Panel>
          );
        })
      )}

      <Panel title="What we store">
        <p>
          Only the credential you enter, encrypted, and whether the provider last refused it. The secret is never shown
          again and never appears in a page, a log line, or an error message. Removing it stops all lookups for that
          installation immediately; your recorded board evidence is untouched.
        </p>
        <p>
          <Link href="https://nexar.com/api">Nexar</Link> issues client credentials from its developer portal.
        </p>
      </Panel>
    </div>
  );
}
