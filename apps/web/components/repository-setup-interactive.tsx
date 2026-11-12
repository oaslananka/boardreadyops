"use client";

import type { RepositorySetupPreset } from "@boardreadyops/cloud-core/repository-setup";
import Link from "next/link";
import { useCallback, useState } from "react";
import { customerStatusLabel } from "../lib/customer-nomenclature.js";
import type { InstallationCapabilities } from "../lib/installation-capabilities.js";
import { deriveRepositorySetupState } from "../lib/repository-setup-state.js";
import { AppPermissionProfile } from "./app-permission-profile.js";
import { CopyButton } from "./copy-button.js";
import { Alert, Definition, DefinitionGrid, Panel, StatusBadge } from "./ui.js";
import { YamlSyntaxHighlighter } from "./yaml-syntax-highlighter.js";

export type SetupTargetRepository = {
  id: string;
  fullName: string;
  accountLogin: string;
  setupRevision?: number;
  setupPreset?: string;
  setupWorkflowStatus?: string;
  setupConfigStatus?: string;
  setupObservedSha?: string;
  setupProbeId?: string;
  setupProbeStatus?: string;
  setupProbeWorkflowRunId?: string;
  setupProbeExpiresAt?: string;
  /** Most recent run visible to the selected installation. The Run route reauthorizes access. */
  latestRunId?: string;
  /** Scoped to this repository's actual GitHub App installation, not the first selector entry. */
  installationGrants?: Pick<InstallationCapabilities, "permissions" | "missing" | "manageUrl">;
  setupBlockedReason?: string;
  readinessBlockedReason?: string;
  /** Full readiness execution is distinct from setup validation and may be rollout-gated. */
  readinessRunBlockedReason?: string;
};

export type RepositorySetupInteractiveProps = {
  presets: readonly RepositorySetupPreset[];
  initialPresetId: string;
  /** Server-validated repository deep link; empty means the requested repository is unavailable. */
  initialRepositoryId?: string;
  presetVersion: number;
  workflowPath: string;
  workflowContractVersion: number;
  workflowSource: string;
  /** Repositories the viewer's session may act on. Empty for a signed-out visitor. */
  repositories?: readonly SetupTargetRepository[];
  signedIn?: boolean;
  hasInstallation?: boolean;
  accessUnavailable?: boolean;
  /** Why the one-click path is unavailable for this installation, when it is. */
};

type SetupPrResult = {
  ok: boolean;
  outcome?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  error?: string;
  manageUrl?: string;
  setupRevision?: number;
};

type SetupProbeResult = {
  ok: boolean;
  outcome?: string;
  probeId?: string;
  status?: string;
  workflowRunId?: string;
  workflowRunUrl?: string;
  error?: string;
  manageUrl?: string;
};

type RepositoryActionResponse =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; manageUrl?: string };

async function requestRepositoryAction(
  repositoryId: string,
  payload: Record<string, unknown>,
  fallbackError: string,
): Promise<RepositoryActionResponse> {
  try {
    const response = await fetch(`/api/v1/repositories/${encodeURIComponent(repositoryId)}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok || data.ok !== true) {
      return {
        ok: false,
        error: typeof data.error === "string" ? data.error : fallbackError,
        ...(typeof data.manageUrl === "string" ? { manageUrl: data.manageUrl } : {}),
      };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: "The network request failed. Check your connection and try again." };
  }
}

/**
 * Opens the setup pull request as the signed-in viewer.
 *
 * This used to call the operator API, which authenticates with a control-plane bearer token no
 * browser has, so the button could only ever have returned 401 — which is why the page never
 * passed the props that would have rendered it. The session-authenticated route re-checks that
 * the viewer's installations cover this repository before it writes anything.
 */
async function requestSetupPr(
  repositoryId: string,
  presetId: string,
  updateExistingSetup = false,
): Promise<SetupPrResult> {
  const response = await requestRepositoryAction(
    repositoryId,
    {
      action: "setup",
      preset: presetId,
      requestId: `ui-setup-${Date.now()}`,
      ...(updateExistingSetup ? { updateExistingSetup: true } : {}),
    },
    "The setup pull request could not be opened.",
  );
  if (!response.ok) return response;
  const { data } = response;
  return {
    ok: true,
    ...(typeof data.outcome === "string" ? { outcome: data.outcome } : {}),
    ...(typeof data.pullRequestNumber === "number" ? { pullRequestNumber: data.pullRequestNumber } : {}),
    ...(typeof data.pullRequestUrl === "string" ? { pullRequestUrl: data.pullRequestUrl } : {}),
    ...(typeof data.setupRevision === "number" ? { setupRevision: data.setupRevision } : {}),
  };
}

async function requestSetupProbe(repositoryId: string): Promise<SetupProbeResult> {
  const response = await requestRepositoryAction(
    repositoryId,
    { action: "validate-setup", requestId: `ui-setup-probe-${Date.now()}` },
    "Repository readiness could not be validated.",
  );
  if (!response.ok) return response;
  const { data } = response;
  return {
    ok: true,
    ...(typeof data.outcome === "string" ? { outcome: data.outcome } : {}),
    ...(typeof data.probeId === "string" ? { probeId: data.probeId } : {}),
    ...(typeof data.status === "string" ? { status: data.status } : {}),
    ...(typeof data.workflowRunId === "string" ? { workflowRunId: data.workflowRunId } : {}),
    ...(typeof data.workflowRunUrl === "string" ? { workflowRunUrl: data.workflowRunUrl } : {}),
  };
}

function SetupPrResultOutput({ result }: Readonly<{ result: SetupPrResult }>) {
  const tone = result.ok
    ? "border-primary/40 bg-primary/10 text-foreground"
    : "border-destructive/40 bg-destructive/10 text-destructive";
  return (
    <output className={`mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm ${tone}`}>
      {result.ok ? (
        <>
          <span>
            ✓ Setup pull request #{result.pullRequestNumber}{" "}
            {result.outcome === "already_exists" ? "is already open" : "created"}!
          </span>
          {result.pullRequestUrl ? (
            <a
              href={result.pullRequestUrl}
              target="_blank"
              rel="noreferrer"
              className="font-semibold underline underline-offset-2 text-primary"
            >
              View pull request on GitHub →
            </a>
          ) : null}
        </>
      ) : (
        <span>
          {result.error}
          {result.manageUrl ? (
            <>
              {" "}
              <a href={result.manageUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                Review the installation on GitHub →
              </a>
            </>
          ) : null}
        </span>
      )}
    </output>
  );
}

function RepositoryFirstPicker({
  signedIn,
  hasInstallation,
  accessUnavailable,
  repositories,
  repositoryId,
  onSelectRepository,
  disabled,
}: Readonly<{
  signedIn: boolean;
  hasInstallation: boolean;
  accessUnavailable: boolean;
  repositories: readonly SetupTargetRepository[];
  repositoryId: string;
  onSelectRepository: (id: string) => void;
  disabled: boolean;
}>) {
  if (!signedIn) {
    return (
      <section aria-label="Choose your GitHub repository" className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold text-foreground">First, connect your GitHub account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to choose an authorized repository. No files change just by signing in.
        </p>
        <a
          href="/api/auth/github/login"
          className="mt-3 inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          Sign in with GitHub
        </a>
      </section>
    );
  }

  if (accessUnavailable) {
    return (
      <section aria-label="Choose your GitHub repository" className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold text-foreground">GitHub repository access unavailable</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          We could not verify your current GitHub App repository selection. No saved projects were changed.
        </p>
        <a
          href="/setup"
          className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          Retry access check
        </a>
      </section>
    );
  }

  if (repositories.length === 0) {
    return (
      <section aria-label="Choose your GitHub repository" className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold text-foreground">
          {hasInstallation ? "Select repositories on GitHub" : "Connect your first GitHub repository"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {hasInstallation
            ? "Choose the repositories allowed for BoardReadyOps in your existing App installation, then return here."
            : "Install the GitHub App on a repository containing your board files."}
        </p>
        <a
          href={
            hasInstallation
              ? "https://github.com/settings/installations"
              : "https://github.com/apps/boardreadyops/installations/new"
          }
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          {hasInstallation ? "Manage selected repositories" : "Install the GitHub App"}
        </a>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="setup-first-repository-heading"
      className="rounded-xl border border-primary/30 bg-card p-4 shadow-e1 sm:p-5"
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(16rem,1.2fr)] md:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Start here</p>
          <h2 id="setup-first-repository-heading" className="mt-1 text-lg font-semibold text-foreground">
            Which repository has your board?
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose one of your authorized repositories first. Selecting it makes no changes.
          </p>
        </div>
        <div className="min-w-0">
          <label htmlFor="one-click-setup-repository" className="text-sm font-medium text-foreground">
            Repository
          </label>
          <select
            id="one-click-setup-repository"
            value={repositoryId}
            disabled={disabled}
            onChange={(event) => onSelectRepository(event.currentTarget.value)}
            className="mt-1 min-h-11 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="" disabled>
              Choose an authorized repository
            </option>
            {repositories.map((repository) => (
              <option key={repository.id} value={repository.id}>
                {repository.fullName}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}

export function RepositorySetupInteractive({
  presets,
  initialPresetId,
  initialRepositoryId,
  presetVersion,
  workflowPath,
  workflowContractVersion,
  workflowSource,
  repositories = [],
  signedIn = false,
  hasInstallation = false,
  accessUnavailable = false,
}: Readonly<RepositorySetupInteractiveProps>) {
  const [selectedId, setSelectedId] = useState(initialPresetId);
  const [isCreatingPr, setIsCreatingPr] = useState(false);
  const [prResult, setPrResult] = useState<SetupPrResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [probeResult, setProbeResult] = useState<SetupProbeResult | null>(null);
  const [repositoryId, setRepositoryId] = useState(() => {
    if (initialRepositoryId !== undefined) {
      if (repositories.some((repository) => repository.id === initialRepositoryId)) return initialRepositoryId;
      return "";
    }
    if (repositories.length === 1) return repositories[0]?.id ?? "";
    return "";
  });
  const [setupOverrides, setSetupOverrides] = useState<
    Record<
      string,
      Required<
        Pick<SetupTargetRepository, "setupRevision" | "setupPreset" | "setupWorkflowStatus" | "setupConfigStatus">
      >
    >
  >({});

  const fallback = presets[0];
  if (!fallback) throw new Error("At least one preset must be provided");
  const activePreset = presets.find((p) => p.id === selectedId) ?? fallback;

  const handleSelectPreset = useCallback((presetId: string) => {
    setSelectedId(presetId);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("preset", presetId);
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const handleCreateSetupPr = useCallback(
    async (updateExistingSetup = false) => {
      if (!repositoryId) return;
      setIsCreatingPr(true);
      setPrResult(null);
      const result = await requestSetupPr(repositoryId, activePreset.id, updateExistingSetup);
      setPrResult(result);
      const setupRevision = result.setupRevision;
      if (result.ok && setupRevision !== undefined && Number.isSafeInteger(setupRevision) && setupRevision > 0) {
        setSetupOverrides((current) => ({
          ...current,
          [repositoryId]: {
            setupRevision,
            setupPreset: activePreset.id,
            setupWorkflowStatus: "unknown",
            setupConfigStatus: "unknown",
          },
        }));
      }
      setIsCreatingPr(false);
    },
    [repositoryId, activePreset.id],
  );

  const handleValidateReadiness = useCallback(async () => {
    if (!repositoryId) return;
    setIsValidating(true);
    setProbeResult(null);
    const result = await requestSetupProbe(repositoryId);
    setProbeResult(result);
    setIsValidating(false);
  }, [repositoryId]);

  const handleSelectRepository = useCallback((id: string) => {
    setRepositoryId(id);
    setPrResult(null);
    setProbeResult(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("repositoryId", id);
      else url.searchParams.delete("repositoryId");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const selectedRepository = repositories.find((repository) => repository.id === repositoryId);
  const displayedRepository = selectedRepository
    ? { ...selectedRepository, ...(setupOverrides[repositoryId] ?? {}) }
    : undefined;

  return (
    <>
      <RepositoryFirstPicker
        signedIn={signedIn}
        hasInstallation={hasInstallation}
        accessUnavailable={accessUnavailable}
        repositories={repositories}
        repositoryId={repositoryId}
        onSelectRepository={handleSelectRepository}
        disabled={isCreatingPr || isValidating}
      />

      {displayedRepository ? (
        <>
          <Panel
            id="automated-setup"
            title={
              displayedRepository && deriveRepositorySetupState(displayedRepository).id === "ready"
                ? "Setup is already verified"
                : "Open a setup pull request"
            }
            description={
              displayedRepository && deriveRepositorySetupState(displayedRepository).id === "ready"
                ? "Continue to your runs, or explicitly choose to update the verified repository configuration."
                : "Recommended starting policy: " +
                  activePreset.name +
                  ". You can review or change it below before opening the PR."
            }
          >
            <OneClickSetup
              signedIn={signedIn}
              repositories={repositories}
              repositoryId={repositoryId}
              {...(displayedRepository ? { repository: displayedRepository } : {})}
              onCreate={() => void handleCreateSetupPr(false)}
              onUpdate={() => void handleCreateSetupPr(true)}
              isCreating={isCreatingPr}
              workflowPath={workflowPath}
              {...(displayedRepository?.setupBlockedReason
                ? { blockedReason: displayedRepository.setupBlockedReason }
                : {})}
              {...(prResult ? { result: prResult } : {})}
            />
          </Panel>

          <SetupReadiness
            signedIn={signedIn}
            {...(displayedRepository ? { repository: displayedRepository } : {})}
            isValidating={isValidating}
            onValidate={handleValidateReadiness}
            {...(displayedRepository?.readinessBlockedReason
              ? { blockedReason: displayedRepository.readinessBlockedReason }
              : {})}
            {...(probeResult ? { result: probeResult } : {})}
          />
          <details aria-label="Advanced setup configuration" className="rounded-xl border border-border bg-card p-4">
            <summary className="min-h-11 cursor-pointer text-sm font-semibold text-foreground hover:text-primary">
              Advanced setup: policy, proposed files and permissions
            </summary>
            <div className="mt-5 space-y-5 border-t border-border pt-5">
              <SetupProgress {...(displayedRepository ? { repository: displayedRepository } : {})} />
              <Panel
                id="policy-preset"
                title="Choose a release policy"
                description={`Preset v${presetVersion}. Switching presets starts a new revision; runs you have already done keep the policy they were checked against.`}
              >
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {presets.map((preset) => {
                    const isSelected = preset.id === activePreset.id;
                    return (
                      <article
                        className={`flex flex-col gap-2 rounded-md border p-4 transition-all duration-150 ${
                          isSelected
                            ? "border-primary bg-card shadow-sm shadow-primary/10 ring-1 ring-primary/40"
                            : "border-border bg-card hover:border-primary/40 hover:bg-muted/10"
                        }`}
                        data-selected={isSelected || undefined}
                        key={preset.id}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2 [&>div]:min-w-0">
                          <h3 className="text-base font-bold text-foreground">{preset.name}</h3>
                          {isSelected ? <StatusBadge value="selected" label="Selected" /> : null}
                        </div>
                        <p className="text-xs uppercase text-muted-foreground">
                          {isSelected ? "Current preview" : "Available release policy"}
                        </p>
                        <p className="text-sm text-muted-foreground">{preset.description}</p>
                        <DefinitionGrid>
                          <Definition label="Release mode">{preset.releaseMode}</Definition>
                          <Definition label="Fail threshold">{preset.failOn}</Definition>
                        </DefinitionGrid>
                        <div className="mt-1">
                          <p className="text-meta font-medium text-foreground">What changes</p>
                          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                            {preset.changes.map((change) => (
                              <li key={change}>{change}</li>
                            ))}
                          </ul>
                        </div>
                        <Link
                          className={`mt-2 inline-flex min-h-11 w-fit items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.98] ${
                            isSelected
                              ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs"
                              : "border-border bg-secondary text-secondary-foreground hover:bg-secondary/80"
                          }`}
                          href={`/setup?preset=${preset.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            handleSelectPreset(preset.id);
                          }}
                          aria-current={isSelected ? "page" : undefined}
                        >
                          {isSelected ? `Active: ${preset.name}` : `Preview ${preset.name}`}
                        </Link>
                      </article>
                    );
                  })}
                </div>
              </Panel>

              <Panel
                id="proposed-files"
                title="Review proposed repository files"
                description="These are the only repository-owned files required for the setup flow. Commit them through a reviewed pull request."
              >
                <div className="flex flex-col gap-4">
                  <article className="rounded-md border border-border bg-card p-4 transition-all">
                    <header className="flex flex-wrap items-start justify-between gap-2 [&>div]:min-w-0">
                      <div>
                        <h3 className="text-sm font-bold text-foreground">boardreadyops.yml</h3>
                        <p className="text-xs text-muted-foreground">Selected preset: {activePreset.name}</p>
                      </div>
                      <StatusBadge value="new" label="New or replace intentionally" />
                    </header>
                    <div className="mt-3">
                      <DefinitionGrid>
                        <Definition label="Blocks">
                          Enabled findings at {activePreset.failOn} severity or above
                        </Definition>
                        <Definition label="Warns">Enabled findings below {activePreset.failOn} severity</Definition>
                        <Definition label="Ignores">Rules explicitly set to false in the preview</Definition>
                      </DefinitionGrid>
                    </div>
                    <YamlSyntaxHighlighter
                      code={activePreset.config}
                      filename="boardreadyops.yml"
                      presetName={activePreset.name}
                    />
                  </article>

                  <article className="rounded-md border border-border bg-card p-4">
                    <header className="flex flex-wrap items-start justify-between gap-2 [&>div]:min-w-0">
                      <div>
                        <h3 className="text-sm font-bold text-foreground">.github/workflows/{workflowPath}</h3>
                        <p className="text-xs text-muted-foreground">
                          Canonical v1 runner workflow, contract v{workflowContractVersion}
                        </p>
                      </div>
                      <StatusBadge value="review" label="Review before copying" />
                    </header>
                    <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm text-foreground">
                      <li>
                        Open the{" "}
                        <a
                          href={workflowSource}
                          className="text-primary underline underline-offset-2"
                          target="_blank"
                          rel="noreferrer"
                        >
                          canonical v1 workflow source
                        </a>{" "}
                        and review its pinned actions, permissions, inputs, and timeouts.
                      </li>
                      <li>
                        Copy it unchanged to <code>.github/workflows/{workflowPath}</code> on a feature branch.
                      </li>
                      <li>
                        Open a pull request and let your repository ruleset and required checks approve the change.
                      </li>
                    </ol>
                  </article>
                </div>
              </Panel>

              <AppPermissionProfile
                {...(displayedRepository?.installationGrants
                  ? {
                      granted: displayedRepository.installationGrants.permissions,
                      missing: displayedRepository.installationGrants.missing,
                      manageUrl: displayedRepository.installationGrants.manageUrl,
                    }
                  : {})}
              />
            </div>
          </details>
        </>
      ) : null}
    </>
  );
}

type SetupReadinessProps = {
  signedIn: boolean;
  repository?: SetupTargetRepository;
  isValidating: boolean;
  onValidate: () => void;
  blockedReason?: string;
  result?: SetupProbeResult;
};

type SetupReadinessView = {
  noRevision: boolean;
  effectiveProbeStatus: string | undefined;
  workflowRunUrl: string | undefined;
  buttonDisabled: boolean;
  actionLabel: string;
};

function effectiveProbeStatus(result: SetupProbeResult | undefined, persisted: string | undefined): string | undefined {
  if (!result?.ok) return persisted;
  if (result.outcome === "dispatched") return "dispatched";
  return result.status ?? persisted;
}

function readinessActionLabel(isValidating: boolean, status: string | undefined): string {
  if (isValidating) return "Validating readiness…";
  if (status === "pending" || status === "dispatched") return "Probe in progress";
  if (status === "failed" || status === "expired") return "Retry readiness";
  if (status === "completed") return "Validate again";
  return "Validate readiness";
}

function setupReadinessView({
  signedIn,
  repository,
  isValidating,
  blockedReason,
  result,
}: Omit<SetupReadinessProps, "onValidate">): SetupReadinessView {
  const noRevision = deriveRepositorySetupState(repository ?? {}).id === "unconfigured";
  const status = effectiveProbeStatus(result, repository?.setupProbeStatus);
  const probeInProgress = status === "pending" || status === "dispatched";
  const workflowRunId = result?.workflowRunId ?? repository?.setupProbeWorkflowRunId;
  const workflowRunUrl =
    result?.workflowRunUrl ??
    (repository && workflowRunId
      ? `https://github.com/${repository.fullName}/actions/runs/${workflowRunId}`
      : undefined);
  return {
    noRevision,
    effectiveProbeStatus: status,
    workflowRunUrl,
    buttonDisabled:
      isValidating || !signedIn || !repository || noRevision || blockedReason !== undefined || probeInProgress,
    actionLabel: readinessActionLabel(isValidating, status),
  };
}

function SetupReadinessSteps() {
  return (
    <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-foreground">
      <li>Confirm GitHub Actions is enabled and the workflow is active on the default branch.</li>
      <li>Dispatch the setup probe with a persisted deadline and idempotency key.</li>
      <li>
        The workflow checks out its own default branch without persisted credentials and validates{" "}
        <code>boardreadyops.yml</code> with a pinned BoardReadyOps CLI.
      </li>
      <li>
        The result is posted with GitHub Actions OIDC bound to the repository ID, workflow ref, branch ref, and probe
        ID.
      </li>
      <li>The verified preset revision is snapshotted onto newly accepted runs and shown in run history.</li>
    </ol>
  );
}

function SetupReadinessActions({
  repository,
  view,
  onValidate,
}: Readonly<{
  repository: SetupTargetRepository | undefined;
  view: SetupReadinessView;
  onValidate: () => void;
}>) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={view.buttonDisabled}
        onClick={onValidate}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-all duration-150 hover:bg-primary/90 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
      >
        {view.actionLabel}
      </button>
      <button
        type="button"
        disabled={!repository}
        onClick={() => window.location.reload()}
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-all duration-150 hover:border-primary/50 hover:bg-muted/20 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
      >
        Refresh status
      </button>
      {view.workflowRunUrl ? (
        <a
          href={view.workflowRunUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-primary underline underline-offset-2"
        >
          Open Actions
        </a>
      ) : null}
    </div>
  );
}

function SetupReadinessStatus({
  repository,
  status,
}: Readonly<{ repository: SetupTargetRepository | undefined; status: string | undefined }>) {
  if (!repository) return null;
  return (
    <DefinitionGrid>
      <Definition label="Repository">{repository.fullName}</Definition>
      <Definition label="Probe status">{status ? customerStatusLabel(status) : "Not dispatched"}</Definition>
      <Definition label="Probe expires">
        {repository.setupProbeExpiresAt ? new Date(repository.setupProbeExpiresAt).toLocaleString() : "Not scheduled"}
      </Definition>
    </DefinitionGrid>
  );
}

function SetupReadinessGuidance({
  signedIn,
  repository,
  noRevision,
  blockedReason,
}: Readonly<{
  signedIn: boolean;
  repository: SetupTargetRepository | undefined;
  noRevision: boolean;
  blockedReason: string | undefined;
}>) {
  return (
    <>
      {!signedIn ? (
        <p className="text-sm text-muted-foreground">
          Sign in with GitHub to validate a repository you are authorized to manage.
        </p>
      ) : null}
      {signedIn && !repository ? (
        <p className="text-sm text-muted-foreground">Connect a repository before validating readiness.</p>
      ) : null}
      {repository && noRevision ? (
        <p className="text-sm text-muted-foreground">
          Open the setup pull request first so BoardReadyOps has a persisted policy revision to validate.
        </p>
      ) : null}
      {blockedReason ? (
        <p className="rounded-md border border-warning/40 bg-warning-surface p-3 text-sm text-foreground">
          {blockedReason}
        </p>
      ) : null}
    </>
  );
}

function SetupReadinessTroubleshooting() {
  return (
    <Alert title="Recovery and troubleshooting" tone="warning">
      <p>
        Missing workflow, disabled Actions, incompatible workflow metadata, missing configuration, invalid
        configuration, expired probe, stale probe, and dispatch failure stay distinct persisted states.
      </p>
      <p>If validation does not dispatch or reports an error, verify:</p>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        <li>
          <strong>Actions permissions:</strong> Confirm GitHub Actions is enabled under Repository Settings &gt; Actions
          &gt; General.
        </li>
        <li>
          <strong>Default branch:</strong> Merge the reviewed setup pull request before validating.
        </li>
        <li>
          <strong>OIDC configuration:</strong> Keep <code>permissions: id-token: write</code> in the canonical workflow.
        </li>
      </ul>
    </Alert>
  );
}

function SetupReadiness(props: Readonly<SetupReadinessProps>) {
  const view = setupReadinessView(props);
  return (
    <Panel
      id="readiness"
      title="4. Validate readiness in GitHub Actions"
      description="Inspect the selected repository workflow, then dispatch the existing 15-minute persisted setup probe."
    >
      <div className="flex flex-col gap-4">
        <SetupReadinessSteps />
        <SetupReadinessActions repository={props.repository} view={view} onValidate={props.onValidate} />
        <SetupReadinessStatus repository={props.repository} status={view.effectiveProbeStatus} />
        <SetupReadinessGuidance
          signedIn={props.signedIn}
          repository={props.repository}
          noRevision={view.noRevision}
          blockedReason={props.blockedReason}
        />
        {props.result ? <SetupProbeResultOutput result={props.result} /> : null}
        <Alert
          title="After validation: run a real hardware check"
          tone={props.repository?.readinessRunBlockedReason ? "warning" : "info"}
        >
          <p>
            A setup probe verifies workflow configuration. It does not produce hardware findings, a signed readiness
            result, or manufacturing approval.
          </p>
          {props.repository?.readinessRunBlockedReason ? (
            <>
              <p>{props.repository.readinessRunBlockedReason}</p>
              <p>
                You can still investigate your hardware while hosted runs are unavailable. A recorded run may be
                incomplete or unsigned, and it does not prove your current design is ready.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {props.repository.latestRunId ? (
                  <Link
                    href={`/runs/${encodeURIComponent(props.repository.latestRunId)}`}
                    className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-2"
                  >
                    Inspect latest recorded run →
                  </Link>
                ) : (
                  <p className="text-sm text-muted-foreground">No earlier run is recorded for this repository yet.</p>
                )}
                <a
                  href="https://github.com/oaslananka/boardreadyops/blob/main/docs/quickstart.md"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-2"
                >
                  Run a local first check →
                </a>
              </div>
              <p>
                A local check can identify issues on the files you have, but it does not enable hosted runs, create an
                OIDC-signed Check Run, or approve fabrication.
              </p>
            </>
          ) : props.repository ? (
            <p>
              After the reviewed setup pull request is merged and the probe succeeds, open a pull request changing your
              hardware project. Inspect the resulting GitHub Check Run for an actionable finding and its hosted run; an
              empty or queued result is not a first useful finding.
            </p>
          ) : (
            <p>Connect and select a repository to see whether full readiness runs are enabled for it.</p>
          )}
        </Alert>
        <SetupReadinessTroubleshooting />
      </div>
    </Panel>
  );
}

function SetupProbeResultOutput({ result }: Readonly<{ result: SetupProbeResult }>) {
  const tone = result.ok
    ? "border-primary/40 bg-primary/10 text-foreground"
    : "border-destructive/40 bg-destructive/10 text-destructive";
  return (
    <output className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm ${tone}`}>
      <span>
        {result.ok
          ? result.outcome === "replayed"
            ? `Readiness probe ${result.status ?? "is already active"}.`
            : "Readiness probe dispatched. The persisted setup state will update after the OIDC callback."
          : result.error}
        {!result.ok && result.manageUrl ? (
          <>
            {" "}
            <a href={result.manageUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              Review the installation on GitHub →
            </a>
          </>
        ) : null}
      </span>
      {result.workflowRunUrl ? (
        <a
          href={result.workflowRunUrl}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-primary underline underline-offset-2"
        >
          View workflow run →
        </a>
      ) : null}
    </output>
  );
}

const setupSteps = [
  { id: "policy-preset", label: "1. Choose a release policy" },
  { id: "proposed-files", label: "2. Review repository-owned files" },
  { id: "automated-setup", label: "3. Open the pull request" },
  { id: "readiness", label: "4. Validate readiness in GitHub Actions" },
] as const;

function setupProgressBadgeValue(stateId: string): "pending" | "ready" | "warning" {
  if (stateId === "ready") return "ready";
  if (stateId === "attention") return "warning";
  return "pending";
}

function SetupProgressDetails({
  repository,
  stateId,
}: Readonly<{ repository: SetupTargetRepository | undefined; stateId: string }>) {
  if (!repository) return null;
  const verifiedCommit =
    stateId === "ready" && repository.setupObservedSha ? repository.setupObservedSha.slice(0, 8) : "Not verified";
  return (
    <DefinitionGrid>
      <Definition label="Setup revision">
        {stateId === "unconfigured" ? "Not created" : `#${repository.setupRevision}`}
      </Definition>
      <Definition label="Persisted policy">{repository.setupPreset?.replaceAll("-", " ") ?? "Not recorded"}</Definition>
      <Definition label="Workflow">
        {repository.setupWorkflowStatus ? customerStatusLabel(repository.setupWorkflowStatus) : "Not checked"}
      </Definition>
      <Definition label="Configuration">
        {repository.setupConfigStatus ? customerStatusLabel(repository.setupConfigStatus) : "Not checked"}
      </Definition>
      <Definition label="Verified commit">{verifiedCommit}</Definition>
    </DefinitionGrid>
  );
}

function SetupProgressStep({
  step,
  stepNumber,
  currentStep,
}: Readonly<{
  step: (typeof setupSteps)[number];
  stepNumber: 1 | 2 | 3 | 4;
  currentStep: 1 | 4;
}>) {
  const current = currentStep === stepNumber;
  const linkState = current ? "border-primary/60 ring-1 ring-primary/30" : "border-border";
  const indexState = current
    ? "border-primary/20 bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground"
    : "border-border bg-muted text-muted-foreground group-hover:border-primary/40 group-hover:text-foreground";
  return (
    <a
      href={`#${step.id}`}
      aria-current={current ? "step" : undefined}
      className={`group flex items-center gap-3.5 rounded-md border bg-card p-3.5 shadow-xs transition-all duration-150 hover:border-primary/60 hover:shadow-sm hover:shadow-primary/5 active:scale-[0.99] ${linkState}`}
    >
      <span
        className={`setup-progress-index flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold transition-colors ${indexState}`}
      >
        {String(stepNumber).padStart(2, "0")}
      </span>
      <strong className="text-sm text-foreground transition-colors group-hover:text-primary">{step.label}</strong>
    </a>
  );
}

function SetupProgressNav({ currentStep }: Readonly<{ currentStep: 1 | 4 }>) {
  return (
    <nav className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Repository setup steps">
      {setupSteps.map((step, index) => {
        const stepNumber = (index + 1) as 1 | 2 | 3 | 4;
        return <SetupProgressStep key={step.id} step={step} stepNumber={stepNumber} currentStep={currentStep} />;
      })}
    </nav>
  );
}

// These commands deliberately use no repository-supplied or account-supplied strings.
const localFirstCheckCommands = "npm i -g boardreadyops\nboardreadyops check . --fail-on never";

function SetupProgress({ repository }: Readonly<{ repository?: SetupTargetRepository }>) {
  const state = deriveRepositorySetupState(repository ?? {});
  const label = repository ? state.label : "Preview only";
  const description = repository
    ? state.description
    : "Preview the policy and repository-owned files now. After you sign in and select a repository, this tracker follows the persisted setup state.";
  const setupState = repository ? state.id : "preview";

  return (
    <section
      aria-labelledby="repository-setup-progress-title"
      className="flex flex-col gap-4 rounded-md border border-border bg-card p-4"
      data-setup-state={setupState}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Repository onboarding state</p>
          <h2 id="repository-setup-progress-title" className="text-base font-bold text-foreground">
            {repository?.fullName ?? "Choose a repository to persist setup progress"}
          </h2>
        </div>
        <StatusBadge value={setupProgressBadgeValue(state.id)} label={label} />
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
      {repository?.readinessRunBlockedReason ? (
        <Alert title="Hosted hardware runs are not available yet" tone="warning">
          <p>{repository.readinessRunBlockedReason}</p>
          <p>
            Setup can prepare and validate the repository, but it cannot produce a hosted hardware finding while cloud
            runs are unavailable. A local check cannot create an OIDC-signed hosted run.
          </p>
        </Alert>
      ) : null}
      {repository?.readinessRunBlockedReason ? (
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-sm" data-local-first-check>
          <p className="font-semibold text-foreground">Your first local findings</p>
          <p className="text-muted-foreground">
            Open a terminal in your own KiCad project folder. With Node.js 24 installed, run:
          </p>
          <pre className="overflow-x-auto rounded-md border border-border bg-background p-3 text-xs text-foreground">
            <code>{localFirstCheckCommands}</code>
          </pre>
          <CopyButton
            label="Copy check commands"
            accessibleLabel="Copy BoardReadyOps installation and local hardware check commands"
            value={localFirstCheckCommands}
          />
          <p className="text-muted-foreground">
            The installation requires npm access. The check prints local findings in the terminal; it does not
            automatically create a report file. With <code>--fail-on never</code>, exit code 0 only means the scan
            finished; review findings before manufacturing. This does not produce an OIDC-signed cloud run.
          </p>
        </div>
      ) : null}
      {repository?.readinessRunBlockedReason ? (
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="https://github.com/oaslananka/boardreadyops/blob/main/docs/quickstart.md"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 w-fit items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Run a local hardware check →
          </a>
          <a
            href={state.id === "ready" ? "#readiness" : "#policy-preset"}
            className="inline-flex min-h-11 w-fit items-center rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground"
          >
            {state.id === "ready" ? "Review verified setup →" : "Prepare repository setup →"}
          </a>
        </div>
      ) : state.id === "ready" ? (
        <Link
          href={`/repositories/${repository?.id}`}
          className="inline-flex min-h-11 w-fit items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          View this repository's readiness runs →
        </Link>
      ) : (
        <a
          href="#policy-preset"
          className="inline-flex min-h-11 w-fit items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Review policy and next setup step →
        </a>
      )}
      <SetupProgressDetails repository={repository} stateId={state.id} />
      <SetupProgressNav currentStep={state.currentStep} />
    </section>
  );
}

type OneClickSetupProps = {
  signedIn: boolean;
  repositories: readonly SetupTargetRepository[];
  repositoryId: string;
  repository?: SetupTargetRepository;
  onCreate: () => void;
  onUpdate: () => void;
  isCreating: boolean;
  workflowPath: string;
  blockedReason?: string;
  result?: SetupPrResult;
};

/**
 * Step 3 renders in every state rather than disappearing.
 *
 * The panel used to be hidden unless an installation and repository were both supplied, and the
 * only page that rendered the component supplied neither, so the product's headline "install
 * once and we do the rest" promise had no visible entry point at all. Each state now says what
 * it is and what the next move is.
 */
function OneClickSetup({
  signedIn,
  repositories,
  repositoryId,
  repository,
  onCreate,
  onUpdate,
  isCreating,
  workflowPath,
  blockedReason,
  result,
}: Readonly<OneClickSetupProps>) {
  const setupVerified = repository !== undefined && deriveRepositorySetupState(repository).id === "ready";

  if (!signedIn) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          Sign in at the top of this page to choose a repository and review a setup pull request. You may copy the files
          above and commit them yourself, but that does not register a BoardReadyOps setup revision and does not verify
          readiness.
        </p>
      </div>
    );
  }

  if (repositories.length === 0) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          Connect a repository with the GitHub App at the top of this page before opening a setup pull request.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {repository?.fullName ?? "Select a repository above to continue"}
          </p>
          <p className="mt-1.5 text-meta text-muted-foreground">
            {setupVerified ? (
              "No new setup pull request is needed. The repository workflow and configuration are already verified."
            ) : (
              <>
                Creates branch <code>boardreadyops/setup</code> with <code>boardreadyops.yml</code> and{" "}
                <code>.github/workflows/{workflowPath}</code>, then opens a pull request. Nothing reaches your default
                branch until you merge it. Existing custom setup files are preserved during first-time setup.
              </>
            )}
          </p>
        </div>
        {setupVerified ? (
          <Link
            href="/runs"
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-all hover:bg-primary/90"
          >
            View runs →
          </Link>
        ) : (
          <button
            type="button"
            disabled={isCreating || blockedReason !== undefined || !repositoryId}
            onClick={onCreate}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-all duration-150 hover:bg-primary/90 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          >
            {isCreating ? "Opening pull request…" : "Open setup pull request"}
          </button>
        )}
      </div>

      {setupVerified ? (
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">Change verified setup</summary>
          <p className="mt-2 text-sm text-muted-foreground">
            Reconfiguration creates a reviewed pull request for the policy and workflow files in Advanced setup. It does
            not change your default branch until you merge it.
          </p>
          <button
            type="button"
            disabled={isCreating || blockedReason !== undefined || !repositoryId}
            onClick={onUpdate}
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
          >
            {isCreating ? "Opening pull request…" : "Open configuration update PR"}
          </button>
        </details>
      ) : null}

      {blockedReason ? (
        <p className="rounded-md border border-warning/40 bg-warning-surface p-3 text-sm text-foreground">
          {blockedReason}
        </p>
      ) : null}

      {result ? <SetupPrResultOutput result={result} /> : null}
    </div>
  );
}
