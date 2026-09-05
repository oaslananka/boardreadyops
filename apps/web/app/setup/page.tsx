import {
  isRepositorySetupPresetId,
  repositorySetupPreset,
  repositorySetupPresets,
  repositorySetupPresetVersion,
  repositorySetupWorkflowContractVersion,
  repositorySetupWorkflowPath,
} from "@boardreadyops/cloud-core/repository-setup";
import { RepositorySetupInteractive } from "../../components/repository-setup-interactive.js";
import { Alert, AppShell, Breadcrumbs, Panel, StatusBadge } from "../../components/ui.js";
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
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Repository setup" }]} />
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase text-muted-foreground">Repository setup preview</p>
            <h1 className="text-2xl font-bold text-foreground">
              Choose a policy, review every file, then validate the default branch.
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              BoardReadyOps never writes repository contents with the production GitHub App. Review the exact
              configuration below, commit it through your normal branch protections, and run an OIDC-bound readiness
              probe.
            </p>
          </div>
          <StatusBadge value="preview" label="No repository changes are made here" />
        </header>

        <Alert title="Configuration preview only" tone="info">
          <p>
            No files are written to your repository automatically. Review the exact configuration below, commit it
            through your normal pull request process, and trigger your first run to establish the baseline.
          </p>
        </Alert>

        <nav className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Repository setup steps">
          <a
            href="#policy-preset"
            className="group flex items-center gap-3.5 rounded-md border border-border bg-card p-3.5 shadow-xs transition-all duration-150 hover:border-primary/60 hover:shadow-sm hover:shadow-primary/5 active:scale-[0.99]"
          >
            <span className="setup-progress-index flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary border border-primary/20 text-sm font-bold transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              01
            </span>
            <strong className="text-sm text-foreground transition-colors group-hover:text-primary">
              1. Choose a release policy
            </strong>
          </a>
          <a
            href="#proposed-files"
            className="group flex items-center gap-3.5 rounded-md border border-border bg-card p-3.5 shadow-xs transition-all duration-150 hover:border-primary/60 hover:shadow-sm hover:shadow-primary/5 active:scale-[0.99]"
          >
            <span className="setup-progress-index flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground border border-border text-sm font-bold transition-colors group-hover:border-primary/40 group-hover:text-foreground">
              02
            </span>
            <strong className="text-sm text-foreground transition-colors group-hover:text-primary">
              2. Review repository-owned files
            </strong>
          </a>
          <a
            href="#readiness"
            className="group flex items-center gap-3.5 rounded-md border border-border bg-card p-3.5 shadow-xs transition-all duration-150 hover:border-primary/60 hover:shadow-sm hover:shadow-primary/5 active:scale-[0.99]"
          >
            <span className="setup-progress-index flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground border border-border text-sm font-bold transition-colors group-hover:border-primary/40 group-hover:text-foreground">
              03
            </span>
            <strong className="text-sm text-foreground transition-colors group-hover:text-primary">
              3. Validate readiness in GitHub Actions
            </strong>
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
              <a href="#policy-preset" className="text-primary hover:underline">
                Continue with repository setup
              </a>{" "}
              by choosing a preset and reviewing the two repository-owned files below.
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

        <RepositorySetupInteractive
          presets={repositorySetupPresets}
          initialPresetId={selected.id}
          presetVersion={repositorySetupPresetVersion}
          workflowPath={repositorySetupWorkflowPath}
          workflowContractVersion={repositorySetupWorkflowContractVersion}
          workflowSource={workflowSource}
        />

        <Panel
          id="readiness"
          title="3. Validate readiness in GitHub Actions"
          description="The control plane first inspects Actions and workflow metadata, then dispatches a short-lived probe owned by the target repository."
        >
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-foreground">
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
          <div className="mt-4">
            <Alert title="Recovery and troubleshooting" tone="warning">
              <p>
                Missing workflow, disabled Actions, incompatible workflow metadata, missing configuration, invalid
                configuration, expired probe, stale probe, and dispatch failure are distinct persisted states with
                stable operator responses.
              </p>
              <p>If your initial readiness probe does not appear or reports an error, verify:</p>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                <li>
                  <strong>Actions permissions:</strong> Confirm GitHub Actions is enabled under Repository Settings &gt;
                  Actions &gt; General.
                </li>
                <li>
                  <strong>Local validation:</strong> Run <code>boardreadyops scan</code> locally before committing to
                  verify <code>boardreadyops.yml</code> syntax.
                </li>
                <li>
                  <strong>OIDC configuration:</strong> Verify your workflow includes{" "}
                  <code>permissions: id-token: write</code> without manual credential overrides.
                </li>
              </ul>
            </Alert>
          </div>
        </Panel>

        <Panel
          id="permissions"
          title="Permission review"
          description="No hidden organization or account access is requested."
        >
          <section className="overflow-x-auto" aria-labelledby="permission-table-caption">
            <table className="w-full text-left text-sm">
              <caption className="sr-only" id="permission-table-caption">
                Required GitHub App permissions and purposes
              </caption>
              <thead>
                <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                  <th scope="col" className="py-2 pr-3">
                    Scope
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Permission
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Purpose
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-foreground">
                    Repository
                  </th>
                  <td className="py-2 pr-3">Metadata: read</td>
                  <td className="py-2 pr-3 text-muted-foreground">Bind the installation to the intended repository.</td>
                </tr>
                <tr className="border-b border-border">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-foreground">
                    Repository
                  </th>
                  <td className="py-2 pr-3">Pull requests: read</td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    Attach each run to the pull request it belongs to.
                  </td>
                </tr>
                <tr className="border-b border-border">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-foreground">
                    Repository
                  </th>
                  <td className="py-2 pr-3">Checks: write</td>
                  <td className="py-2 pr-3 text-muted-foreground">Publish verified readiness conclusions.</td>
                </tr>
                <tr className="border-b border-border">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-foreground">
                    Repository
                  </th>
                  <td className="py-2 pr-3">Actions: write</td>
                  <td className="py-2 pr-3 text-muted-foreground">Dispatch the repository-owned readiness workflow.</td>
                </tr>
                <tr className="border-b border-border">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-foreground">
                    Repository
                  </th>
                  <td className="py-2 pr-3">Contents: none</td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    Repository files stay under contributor-controlled pull requests.
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-foreground">
                    Organization / account
                  </th>
                  <td className="py-2 pr-3">None</td>
                  <td className="py-2 pr-3 text-muted-foreground">No organization-wide or user-account authority.</td>
                </tr>
              </tbody>
            </table>
          </section>
        </Panel>
      </main>
    </AppShell>
  );
}
