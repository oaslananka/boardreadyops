import {
  isRepositorySetupPresetId,
  repositorySetupPreset,
  repositorySetupPresets,
  repositorySetupPresetVersion,
  repositorySetupWorkflowContractVersion,
  repositorySetupWorkflowPath,
} from "@boardreadyops/cloud-core/repository-setup";
import Link from "next/link";
import { Alert, AppShell, Breadcrumbs, Definition, DefinitionGrid, Panel, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";

export const metadata = {
  title: "Repository setup preview",
  description: "Preview BoardReadyOps policy presets, repository files, permissions, and readiness validation.",
};

type SetupPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const parameters = await searchParams;
  const selectedValue = first(parameters.preset);
  const hasInstallationHandoff = first(parameters.installation_id) !== undefined;
  const defaultPreset = repositorySetupPreset("prototype");
  if (!defaultPreset) throw new Error("prototype setup preset is unavailable");
  const selected =
    repositorySetupPreset(isRepositorySetupPresetId(selectedValue) ? selectedValue : "prototype") ?? defaultPreset;
  const workflowSource = `https://github.com/oaslananka/boardreadyops/blob/v1/.github/workflows/${repositorySetupWorkflowPath}`;

  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="page-frame operational-page setup-page" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Repository setup" }]} />
        <header className="page-intro setup-hero">
          <div>
            <p className="eyebrow">Repository setup preview</p>
            <h1>Choose a policy, review every file, then validate the default branch.</h1>
            <p>
              BoardReadyOps never writes repository contents with the production GitHub App. Review the exact
              configuration below, commit it through your normal branch protections, and run an OIDC-bound readiness
              probe.
            </p>
          </div>
          <StatusBadge value="preview" label="No repository changes are made here" />
        </header>

        <nav className="setup-journey" aria-label="Repository setup steps">
          <a href="#policy-preset">
            <span className="setup-progress-index setup-journey-index">01</span>
            <strong>1. Choose a release policy</strong>
          </a>
          <a href="#proposed-files">
            <span className="setup-progress-index setup-journey-index">02</span>
            <strong>2. Review repository-owned files</strong>
          </a>
          <a href="#readiness">
            <span className="setup-progress-index setup-journey-index">03</span>
            <strong>3. Validate readiness in GitHub Actions</strong>
          </a>
        </nav>

        {hasInstallationHandoff ? (
          <Alert title="GitHub App installation handoff" tone="success">
            <p>
              This URL includes the same <code>installation_id</code> parameter GitHub adds to its post-installation
              handoff. It is an untrusted redirect parameter: this page never displays it, does not authorize repository
              access from it, and does not load tenant data without authenticated control-plane access.
            </p>
            <p>
              <a href="#policy-preset">Continue with repository setup</a> by choosing a preset and reviewing the two
              repository-owned files below.
            </p>
          </Alert>
        ) : null}

        <Alert title="Least privilege is preserved" tone="info">
          <p>
            The App uses Metadata read, Pull requests read, Checks write, and Actions write. Contents access,
            organization permissions, and account permissions remain disabled. Any future assisted installation would
            require a separate, explicit opt-in to Contents write.
          </p>
        </Alert>

        <Panel
          id="policy-preset"
          title="1. Choose a release policy"
          description={`Preset v${repositorySetupPresetVersion}. Switching presets starts a new revision; runs you have already done keep the policy they were checked against.`}
        >
          <div className="setup-preset-grid">
            {repositorySetupPresets.map((preset) => (
              <article
                className="setup-preset-card"
                data-selected={preset.id === selected.id || undefined}
                key={preset.id}
              >
                <div className="setup-preset-card-heading">
                  <h3>{preset.name}</h3>
                  {preset.id === selected.id ? <StatusBadge value="selected" label="Selected" /> : null}
                </div>
                <p className="setup-preset-state">
                  {preset.id === selected.id ? "Current preview" : "Available release policy"}
                </p>
                <p>{preset.description}</p>
                <DefinitionGrid>
                  <Definition label="Release mode">{preset.releaseMode}</Definition>
                  <Definition label="Fail threshold">{preset.failOn}</Definition>
                </DefinitionGrid>
                <Link
                  className="button button-secondary"
                  href={`/setup?preset=${preset.id}`}
                  aria-current={preset.id === selected.id ? "page" : undefined}
                >
                  Preview {preset.name}
                </Link>
              </article>
            ))}
          </div>
        </Panel>

        <Panel
          id="proposed-files"
          title="2. Review repository-owned files"
          description="These are the only repository-owned files required for the setup flow. Commit them through a reviewed pull request."
        >
          <div className="setup-file-list">
            <article className="setup-file-preview">
              <header>
                <div>
                  <h3>boardreadyops.yml</h3>
                  <p>Selected preset: {selected.name}</p>
                </div>
                <StatusBadge value="new" label="New or replace intentionally" />
              </header>
              <DefinitionGrid>
                <Definition label="Blocks">Enabled findings at {selected.failOn} severity or above</Definition>
                <Definition label="Warns">Enabled findings below {selected.failOn} severity</Definition>
                <Definition label="Ignores">Rules explicitly set to false in the preview</Definition>
              </DefinitionGrid>
              <figure className="setup-code-figure">
                <figcaption id="setup-config-preview-caption">{selected.name} boardreadyops.yml preview</figcaption>
                <textarea
                  className="setup-code-preview"
                  aria-labelledby="setup-config-preview-caption"
                  readOnly
                  rows={Math.min(selected.config.split("\n").length, 28)}
                  spellCheck={false}
                  value={selected.config}
                />
              </figure>
            </article>
            <article className="setup-file-preview">
              <header>
                <div>
                  <h3>.github/workflows/{repositorySetupWorkflowPath}</h3>
                  <p>Canonical v1 runner workflow, contract v{repositorySetupWorkflowContractVersion}</p>
                </div>
                <StatusBadge value="review" label="Review before copying" />
              </header>
              <ol className="setup-steps">
                <li>
                  Open the <a href={workflowSource}>canonical v1 workflow source</a> and review its pinned actions,
                  permissions, inputs, and timeouts.
                </li>
                <li>
                  Copy it unchanged to <code>.github/workflows/{repositorySetupWorkflowPath}</code> on a feature branch.
                </li>
                <li>Open a pull request and let your repository ruleset and required checks approve the change.</li>
              </ol>
            </article>
          </div>
        </Panel>

        <Panel
          id="readiness"
          title="3. Validate readiness in GitHub Actions"
          description="The control plane first inspects Actions and workflow metadata, then dispatches a short-lived probe owned by the target repository."
        >
          <ol className="setup-steps">
            <li>Confirm GitHub Actions is enabled and the workflow is active on the default branch.</li>
            <li>Dispatch the setup probe with a 15-minute persisted deadline and idempotency key.</li>
            <li>
              The workflow checks out its own default branch without persisted credentials and validates{" "}
              <code>boardreadyops.yml</code>
              with a pinned BoardReadyOps CLI.
            </li>
            <li>
              The result is posted with GitHub Actions OIDC bound to the repository ID, workflow ref, branch ref, and
              probe ID.
            </li>
            <li>The verified preset revision is snapshotted onto every newly accepted run and shown in run history.</li>
          </ol>
          <Alert title="Troubleshooting remains explicit" tone="warning">
            <p>
              Missing workflow, disabled Actions, incompatible workflow metadata, missing configuration, invalid
              configuration, expired probe, stale probe, and dispatch failure are distinct persisted states with stable
              operator responses.
            </p>
          </Alert>
        </Panel>

        <Panel
          id="permissions"
          title="Permission review"
          description="No hidden organization or account access is requested."
        >
          <section className="table-scroll" aria-labelledby="permission-table-caption">
            <table>
              <caption id="permission-table-caption">Required GitHub App permissions and purposes</caption>
              <thead>
                <tr>
                  <th scope="col">Scope</th>
                  <th scope="col">Permission</th>
                  <th scope="col">Purpose</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Repository</th>
                  <td>Metadata: read</td>
                  <td>Bind the installation to the intended repository.</td>
                </tr>
                <tr>
                  <th scope="row">Repository</th>
                  <td>Pull requests: read</td>
                  <td>Attach each run to the pull request it belongs to.</td>
                </tr>
                <tr>
                  <th scope="row">Repository</th>
                  <td>Checks: write</td>
                  <td>Publish verified readiness conclusions.</td>
                </tr>
                <tr>
                  <th scope="row">Repository</th>
                  <td>Actions: write</td>
                  <td>Dispatch the repository-owned readiness workflow.</td>
                </tr>
                <tr>
                  <th scope="row">Repository</th>
                  <td>Contents: none</td>
                  <td>Repository files stay under contributor-controlled pull requests.</td>
                </tr>
                <tr>
                  <th scope="row">Organization / account</th>
                  <td>None</td>
                  <td>No organization-wide or user-account authority.</td>
                </tr>
              </tbody>
            </table>
          </section>
        </Panel>
      </main>
    </AppShell>
  );
}
