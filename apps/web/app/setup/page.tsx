import {
  isSelectableRepositorySetupPresetId,
  repositorySetupPreset,
  repositorySetupPresets,
  repositorySetupPresetVersion,
  repositorySetupWorkflowContractVersion,
  repositorySetupWorkflowPath,
} from "@boardreadyops/cloud-core/repository-setup";
import { AppPermissionProfile } from "../../components/app-permission-profile.js";
import { RepositorySetupInteractive } from "../../components/repository-setup-interactive.js";
import { Alert, AppShell, StatusBadge } from "../../components/ui.js";
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
      ...(repository.setupRevision === undefined ? {} : { setupRevision: repository.setupRevision }),
      ...(repository.setupPreset ? { setupPreset: repository.setupPreset } : {}),
      ...(repository.setupWorkflowStatus ? { setupWorkflowStatus: repository.setupWorkflowStatus } : {}),
      ...(repository.setupConfigStatus ? { setupConfigStatus: repository.setupConfigStatus } : {}),
      ...(repository.setupObservedSha ? { setupObservedSha: repository.setupObservedSha } : {}),
      ...(repository.setupProbeId ? { setupProbeId: repository.setupProbeId } : {}),
      ...(repository.setupProbeStatus ? { setupProbeStatus: repository.setupProbeStatus } : {}),
      ...(repository.setupProbeWorkflowRunId ? { setupProbeWorkflowRunId: repository.setupProbeWorkflowRunId } : {}),
      ...(repository.setupProbeExpiresAt ? { setupProbeExpiresAt: repository.setupProbeExpiresAt } : {}),
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
  const readinessBlockedReason = installationGrants?.actions.find(
    (action) => action.id === "validate-setup" && !action.satisfied,
  )?.userExplanation;
  const defaultPreset = repositorySetupPreset("prototype");
  if (!defaultPreset) throw new Error("prototype setup preset is unavailable");
  const selected =
    repositorySetupPreset(isSelectableRepositorySetupPresetId(selectedValue) ? selectedValue : "prototype") ??
    defaultPreset;
  const workflowSource = `https://github.com/oaslananka/boardreadyops/blob/v1/.github/workflows/${repositorySetupWorkflowPath}`;

  return (
    <AppShell viewerNav={<ViewerNav />} breadcrumbs={[{ href: "/", label: "Home" }, { label: "Repository setup" }]}>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase text-muted-foreground">Repository setup</p>
            <h1 className="text-2xl font-bold text-foreground">Connect or check your repository</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              See its current setup status first. GitHub repositories and readiness runs are separate from CAD workspace
              projects and revisions; connecting one does not automatically create the other.
            </p>
          </div>
          <StatusBadge value="preview" label="Nothing changes until you choose" />
        </header>

        <section aria-label="Repository write safety" className="rounded-md border border-border bg-card p-4 text-sm">
          <p className="font-medium text-foreground">
            BoardReadyOps setup writes go to a new branch and open a pull request for review. BoardReadyOps never
            commits to your default branch or bypasses its protections. Files you copy manually are outside this
            guarantee.
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer font-medium text-primary">How setup and permissions work</summary>
            <p className="mt-2 text-muted-foreground">
              Read the files before you decide. You can copy the proposed policy/workflow files to your own branch or
              ask BoardReadyOps to open a reviewable setup pull request. The exact files and the permission profile
              remain below for inspection before choosing.
            </p>
            <p className="mt-2 text-muted-foreground">
              Writes are limited to <code>boardreadyops.yml</code>,{" "}
              <code>.github/workflows/{repositorySetupWorkflowPath}</code> and <code>.boardreadyops/**</code> on a new
              branch. See{" "}
              <a href="#permissions" className="text-primary underline">
                Permission review
              </a>
              .
            </p>
          </details>
        </section>

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
          {...(readinessBlockedReason ? { readinessBlockedReason } : {})}
        />

        <AppPermissionProfile
          {...(installationGrants ? { granted: installationGrants.permissions } : {})}
          {...(installationGrants ? { missing: installationGrants.missing } : {})}
          {...(installationGrants?.manageUrl ? { manageUrl: installationGrants.manageUrl } : {})}
        />
      </main>
    </AppShell>
  );
}
