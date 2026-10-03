"use client";

import type { RepositorySetupPreset } from "@boardreadyops/cloud-core/repository-setup";
import Link from "next/link";
import { useCallback, useState } from "react";
import { customerStatusLabel } from "../lib/customer-nomenclature.js";
import { deriveRepositorySetupState } from "../lib/repository-setup-state.js";
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
};

export type RepositorySetupInteractiveProps = {
  presets: readonly RepositorySetupPreset[];
  initialPresetId: string;
  presetVersion: number;
  workflowPath: string;
  workflowContractVersion: number;
  workflowSource: string;
  /** Repositories the viewer's session may act on. Empty for a signed-out visitor. */
  repositories?: readonly SetupTargetRepository[];
  signedIn?: boolean;
  /** Why the one-click path is unavailable for this installation, when it is. */
  blockedReason?: string;
  /** Why setup readiness validation is unavailable for this installation, when it is. */
  readinessBlockedReason?: string;
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
async function requestSetupPr(repositoryId: string, presetId: string): Promise<SetupPrResult> {
  const response = await requestRepositoryAction(
    repositoryId,
    { action: "setup", preset: presetId, requestId: `ui-setup-${Date.now()}` },
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

export function RepositorySetupInteractive({
  presets,
  initialPresetId,
  presetVersion,
  workflowPath,
  workflowContractVersion,
  workflowSource,
  repositories = [],
  signedIn = false,
  blockedReason,
  readinessBlockedReason,
}: Readonly<RepositorySetupInteractiveProps>) {
  const [selectedId, setSelectedId] = useState(initialPresetId);
  const [isCreatingPr, setIsCreatingPr] = useState(false);
  const [prResult, setPrResult] = useState<SetupPrResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [probeResult, setProbeResult] = useState<SetupProbeResult | null>(null);
  const [repositoryId, setRepositoryId] = useState(repositories[0]?.id ?? "");
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

  const handleCreateSetupPr = useCallback(async () => {
    if (!repositoryId) return;
    setIsCreatingPr(true);
    setPrResult(null);
    const result = await requestSetupPr(repositoryId, activePreset.id);
    setPrResult(result);
    const setupRevision = result.setupRevision;
    if (result.ok && setupRevision !== undefined) {
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
  }, [repositoryId, activePreset.id]);

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
  }, []);

  const selectedRepository = repositories.find((repository) => repository.id === repositoryId);
  const displayedRepository = selectedRepository
    ? { ...selectedRepository, ...(setupOverrides[repositoryId] ?? {}) }
    : undefined;

  return (
    <>
      <SetupProgress {...(displayedRepository ? { repository: displayedRepository } : {})} />

      <Panel
        id="policy-preset"
        title="1. Choose a release policy"
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
        title="2. Review repository-owned files"
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
                <Definition label="Blocks">Enabled findings at {activePreset.failOn} severity or above</Definition>
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
              <li>Open a pull request and let your repository ruleset and required checks approve the change.</li>
            </ol>
          </article>
        </div>
      </Panel>

      <Panel
        id="automated-setup"
        title="3. Open the setup pull request"
        description="Commits the two files above to a new branch and opens a pull request, without a terminal or a local clone."
      >
        <OneClickSetup
          signedIn={signedIn}
          repositories={repositories}
          repositoryId={repositoryId}
          onSelectRepository={handleSelectRepository}
          onCreate={handleCreateSetupPr}
          isCreating={isCreatingPr}
          selectionDisabled={isCreatingPr || isValidating}
          workflowPath={workflowPath}
          {...(blockedReason ? { blockedReason } : {})}
          {...(prResult ? { result: prResult } : {})}
        />
      </Panel>

      <SetupReadiness
        signedIn={signedIn}
        {...(displayedRepository ? { repository: displayedRepository } : {})}
        isValidating={isValidating}
        onValidate={handleValidateReadiness}
        {...(readinessBlockedReason ? { blockedReason: readinessBlockedReason } : {})}
        {...(probeResult ? { result: probeResult } : {})}
      />
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
  const noRevision = repository?.setupRevision === undefined;
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
        {repository.setupRevision === undefined ? "Not created" : `#${repository.setupRevision}`}
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
      <SetupProgressDetails repository={repository} stateId={state.id} />
      <SetupProgressNav currentStep={state.currentStep} />
    </section>
  );
}

type OneClickSetupProps = {
  signedIn: boolean;
  repositories: readonly SetupTargetRepository[];
  repositoryId: string;
  onSelectRepository: (id: string) => void;
  onCreate: () => void;
  isCreating: boolean;
  selectionDisabled: boolean;
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
  onSelectRepository,
  onCreate,
  isCreating,
  selectionDisabled,
  workflowPath,
  blockedReason,
  result,
}: Readonly<OneClickSetupProps>) {
  const selectId = "one-click-setup-repository";

  if (!signedIn) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          Sign in and BoardReadyOps opens the pull request on a repository you pick. You can also copy the two files
          above and commit them yourself — the result is identical.
        </p>
        <a
          href="/api/auth/github/login"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"
        >
          Sign in with GitHub
        </a>
      </div>
    );
  }

  if (repositories.length === 0) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          No repository is connected to your account yet. Install the BoardReadyOps GitHub App on the repository holding
          your KiCad project, then come back to this step.
        </p>
        <a
          href="https://github.com/apps/boardreadyops/installations/new"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"
        >
          Install the GitHub App
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <label htmlFor={selectId} className="text-sm font-medium text-foreground">
            Repository
          </label>
          <select
            id={selectId}
            value={repositoryId}
            disabled={selectionDisabled}
            onChange={(event) => onSelectRepository(event.currentTarget.value)}
            className="mt-1 min-h-11 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {repositories.map((repository) => (
              <option key={repository.id} value={repository.id}>
                {repository.fullName}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-meta text-muted-foreground">
            Creates branch <code>boardreadyops/setup</code> with <code>boardreadyops.yml</code> and{" "}
            <code>.github/workflows/{workflowPath}</code>, then opens a pull request. Nothing reaches your default
            branch until you merge it.
          </p>
        </div>
        <button
          type="button"
          disabled={isCreating || blockedReason !== undefined || !repositoryId}
          onClick={onCreate}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-all duration-150 hover:bg-primary/90 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
        >
          {isCreating ? "Opening pull request…" : "Open setup pull request"}
        </button>
      </div>

      {blockedReason ? (
        <p className="rounded-md border border-warning/40 bg-warning-surface p-3 text-sm text-foreground">
          {blockedReason}
        </p>
      ) : null}

      {result ? <SetupPrResultOutput result={result} /> : null}
    </div>
  );
}
