import {
  isSelectableRepositorySetupPresetId,
  repositorySetupPreset,
  repositorySetupPresets,
  repositorySetupPresetVersion,
  repositorySetupWorkflowContractVersion,
  repositorySetupWorkflowPath,
} from "@boardreadyops/cloud-core/repository-setup";
import { RepositorySetupInteractive } from "../../components/repository-setup-interactive.js";
import { Alert, AppShell, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { loadInstallationCapabilities } from "../../lib/installation-capabilities.js";
import { releaseRepositoryDispatchAvailability } from "../../lib/release-rollout.js";
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
  if (!viewer.session) return { signedIn: false, repositories: [] as const };

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
      // A viewer-scoped run ID is navigation only, not permission to read the run.
      // The Run detail route independently re-checks installation/repository access.
      ...(repository.latestRunId ? { latestRunId: repository.latestRunId } : {}),
    })),
  );

  // Resolve actual grants for EACH installation. First-repository grants may not
  // represent another owner or installation in the selector. Share one lookup
  // across repositories on the same installation, never across installations.
  const installationIds = [...new Set(repositories.map((repository) => repository.githubInstallationId))];
  const grantsByInstallation = new Map(
    await Promise.all(installationIds.map(async (id) => [id, await loadInstallationCapabilities(id)] as const)),
  );
  const scopedRepositories = repositories.map((repository) => {
    const grants = grantsByInstallation.get(repository.githubInstallationId);
    // A setup probe can succeed even when production cloud runs are gated.
    // Derive this per authorized repository; never expose the rollout allowlist.
    const dispatch = releaseRepositoryDispatchAvailability(repository.fullName);
    const target = {
      ...repository,
      ...(!dispatch.enabled ? { readinessRunBlockedReason: dispatch.reason } : {}),
    };
    if (!grants) return target;
    const setupBlockedReason = grants.actions.find(
      (action) => action.id === "setup" && !action.satisfied,
    )?.userExplanation;
    const readinessBlockedReason = grants.actions.find(
      (action) => action.id === "validate-setup" && !action.satisfied,
    )?.userExplanation;
    return {
      ...target,
      installationGrants: { permissions: grants.permissions, missing: grants.missing, manageUrl: grants.manageUrl },
      ...(setupBlockedReason ? { setupBlockedReason } : {}),
      ...(readinessBlockedReason ? { readinessBlockedReason } : {}),
    };
  });
  return { signedIn: true, repositories: scopedRepositories };
}

export default async function SetupPage({ searchParams }: Readonly<SetupPageProps>) {
  const parameters = await searchParams;
  const selectedValue = first(parameters.preset);
  const hasInstallationHandoff = first(parameters.installation_id) !== undefined;
  const targets = await setupTargets();
  // A deep link can select only a repository in the authenticated viewer's installations.
  // Unknown IDs leave the selector empty instead of silently targeting another repository.
  const requestedRepositoryId = first(parameters.repositoryId);
  const initialRepositoryId =
    requestedRepositoryId === undefined
      ? undefined
      : (targets.repositories.find((repository) => repository.id === requestedRepositoryId)?.id ?? "");
  const defaultPreset = repositorySetupPreset("prototype");
  if (!defaultPreset) throw new Error("prototype setup preset is unavailable");
  const selected =
    repositorySetupPreset(isSelectableRepositorySetupPresetId(selectedValue) ? selectedValue : "prototype") ??
    defaultPreset;
  const workflowSource = `https://github.com/oaslananka/boardreadyops/blob/main/.github/workflows/${repositorySetupWorkflowPath}`;

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
          <Alert title="Installation link received — not verified" tone="info">
            <p>
              GitHub may add an <code>installation_id</code> to this URL. It is an untrusted redirect parameter: this
              page never displays it, does not authorize repository access from it, and only lists repositories verified
              against your signed-in session. The link alone does not confirm a completed installation.
            </p>
            {!targets.signedIn ? (
              <p>
                <a
                  href="/api/auth/github/login?return_to=%2Fsetup"
                  className="font-medium text-primary underline underline-offset-2"
                >
                  Sign in to verify repository access
                </a>{" "}
                before continuing with setup.
              </p>
            ) : targets.repositories.length === 0 ? (
              <p>
                No authorized repositories are visible yet. Check your GitHub App repository grants and return here.
              </p>
            ) : (
              <p>
                <a href="#policy-preset" className="font-medium text-primary underline underline-offset-2">
                  Continue with repository setup
                </a>{" "}
                by choosing one of your authorized repositories and reviewing its setup files.
              </p>
            )}
          </Alert>
        ) : null}

        <RepositorySetupInteractive
          presets={repositorySetupPresets}
          initialPresetId={selected.id}
          {...(initialRepositoryId === undefined ? {} : { initialRepositoryId })}
          presetVersion={repositorySetupPresetVersion}
          workflowPath={repositorySetupWorkflowPath}
          workflowContractVersion={repositorySetupWorkflowContractVersion}
          workflowSource={workflowSource}
          repositories={targets.repositories}
          signedIn={targets.signedIn}
        />
      </main>
    </AppShell>
  );
}
