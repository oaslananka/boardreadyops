import {
  isRepositorySetupPresetId,
  repositorySetupPreset,
  repositorySetupPresets,
  repositorySetupPresetVersion,
  repositorySetupWorkflowContractVersion,
  repositorySetupWorkflowPath,
} from "@boardreadyops/cloud-core/repository-setup";
import { AppPermissionProfile } from "../../components/app-permission-profile.js";
import { RepositorySetupInteractive } from "../../components/repository-setup-interactive.js";
import { Alert, AppShell, Panel, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { loadInstallationCapabilities } from "../../lib/installation-capabilities.js";
import { loadViewerRepositories } from "../../lib/repository-dashboard.js";
import { viewerAuthorization } from "../../lib/viewer-authorization.js";

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

/**
 * The repositories a signed-in viewer may open a setup pull request against.
 *
 * Resolved here rather than in the client component so the list is already scoped to the
 * viewer's installations by `loadViewerRepositories`; the client never learns about a repository
 * the session does not cover, and the action route re-checks the same scope anyway.
 */
async function setupTargets() {
  const viewer = await viewerAuthorization();
  if (!viewer.session) return { signedIn: false, repositories: [] as const, capabilities: undefined };

  const groups = await loadViewerRepositories(viewer.session);
  const repositories = groups.flatMap((group) =>
    group.repositories.map((repository) => ({
      id: repository.id,
      fullName: `${repository.owner}/${repository.name}`,
      accountLogin: repository.accountLogin,
      githubInstallationId: repository.githubInstallationId,
    })),
  );

  // Every repository in one installation shares its grants, and nearly every workspace has a
  // single installation, so one reading answers the page. A mixed-installation viewer sees the
  // first installation's grants and the server still refuses per repository with the exact reason.
  const capabilities = await loadInstallationCapabilities(repositories[0]?.githubInstallationId);
  return { signedIn: true, repositories, capabilities };
}

export default async function SetupPage({ searchParams }: Readonly<SetupPageProps>) {
  const parameters = await searchParams;
  const selectedValue = first(parameters.preset);
  const hasInstallationHandoff = first(parameters.installation_id) !== undefined;
  const targets = await setupTargets();
  const installationGrants = targets.capabilities;
  // When the grants are readable and the capability is absent, say so on the button rather than
  // hiding it: a missing permission is a fixable state, and a button that vanished teaches nothing.
  const setupBlockedReason = installationGrants?.actions.find(
    (action) => action.id === "setup" && !action.satisfied,
  )?.userExplanation;
  const defaultPreset = repositorySetupPreset("prototype");
  if (!defaultPreset) throw new Error("prototype setup preset is unavailable");
  const selected =
    repositorySetupPreset(isRepositorySetupPresetId(selectedValue) ? selectedValue : "prototype") ?? defaultPreset;
  const workflowSource = `https://github.com/oaslananka/boardreadyops/blob/v1/.github/workflows/${repositorySetupWorkflowPath}`;

  return (
    <AppShell viewerNav={<ViewerNav />} breadcrumbs={[{ href: "/", label: "Home" }, { label: "Repository setup" }]}>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase text-muted-foreground">Repository setup</p>
            <h1 className="text-2xl font-bold text-foreground">
              Choose a policy, review every file, then let us open the pull request.
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Nothing is committed until you act. Read the exact two files below, then either copy them into your own
              branch or have BoardReadyOps open the pull request for you — the contents are identical either way, and
              both land as a pull request your reviewers approve.
            </p>
          </div>
          <StatusBadge value="preview" label="Nothing changes until you choose" />
        </header>

        <Alert title="Read the files before you decide" tone="info">
          <p>
            Both paths end at the same reviewed pull request against a new branch, never a commit to your default
            branch. Step 3 is where you choose between copying the files yourself and having them opened for you.
          </p>
        </Alert>

        <nav className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Repository setup steps">
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
            href="#automated-setup"
            className="group flex items-center gap-3.5 rounded-md border border-border bg-card p-3.5 shadow-xs transition-all duration-150 hover:border-primary/60 hover:shadow-sm hover:shadow-primary/5 active:scale-[0.99]"
          >
            <span className="setup-progress-index flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground border border-border text-sm font-bold transition-colors group-hover:border-primary/40 group-hover:text-foreground">
              03
            </span>
            <strong className="text-sm text-foreground transition-colors group-hover:text-primary">
              3. Open the pull request
            </strong>
          </a>
          <a
            href="#readiness"
            className="group flex items-center gap-3.5 rounded-md border border-border bg-card p-3.5 shadow-xs transition-all duration-150 hover:border-primary/60 hover:shadow-sm hover:shadow-primary/5 active:scale-[0.99]"
          >
            <span className="setup-progress-index flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground border border-border text-sm font-bold transition-colors group-hover:border-primary/40 group-hover:text-foreground">
              04
            </span>
            <strong className="text-sm text-foreground transition-colors group-hover:text-primary">
              4. Validate readiness in GitHub Actions
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
              <a href="#policy-preset" className="text-primary underline underline-offset-2">
                Continue with repository setup
              </a>{" "}
              by choosing a preset and reviewing the two repository-owned files below.
            </p>
          </Alert>
        ) : null}

        <Alert title="What BoardReadyOps may write, and where it may not" tone="info">
          <p>
            Repository writes are limited to <code>boardreadyops.yml</code>,{" "}
            <code>.github/workflows/{repositorySetupWorkflowPath}</code>, and <code>.boardreadyops/**</code>, always on
            a new branch opened as a pull request for your review. BoardReadyOps never commits to a default branch,
            never bypasses branch protection or required reviews, and requests no organization or account permission.
            The full list is in <a href="#permissions">Permission review</a> below.
          </p>
        </Alert>

        <RepositorySetupInteractive
          presets={repositorySetupPresets}
          initialPresetId={selected.id}
          presetVersion={repositorySetupPresetVersion}
          workflowPath={repositorySetupWorkflowPath}
          workflowContractVersion={repositorySetupWorkflowContractVersion}
          workflowSource={workflowSource}
          repositories={targets.repositories}
          signedIn={targets.signedIn}
          {...(setupBlockedReason ? { blockedReason: setupBlockedReason } : {})}
        />

        <Panel
          id="readiness"
          title="4. Validate readiness in GitHub Actions"
          description="The control plane first inspects Actions and workflow metadata, then dispatches a short-lived probe owned by the target repository."
        >
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-foreground">
            <li>Confirm GitHub Actions is enabled and the workflow is active on the default branch.</li>
            <li>Dispatch the setup probe with a 15-minute persisted deadline and idempotency key.</li>
            <li>
              The workflow checks out its own default branch without persisted credentials and validates{" "}
              <code>boardreadyops.yml</code> with a pinned BoardReadyOps CLI.
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

        <AppPermissionProfile
          {...(installationGrants ? { granted: installationGrants.permissions } : {})}
          {...(installationGrants ? { missing: installationGrants.missing } : {})}
          {...(installationGrants?.manageUrl ? { manageUrl: installationGrants.manageUrl } : {})}
        />
      </main>
    </AppShell>
  );
}
