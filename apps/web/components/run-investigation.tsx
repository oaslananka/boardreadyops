import Link from "next/link";
import type { ReactNode } from "react";
import type { RunDashboardFilters, RunDetail } from "../lib/run-dashboard.js";

type ArtifactDetail = RunDetail["artifacts"][number];
type AttemptDetail = RunDetail["attempts"][number];
type FindingDetail = RunDetail["findings"][number];

import { formatArtifactBytes, formatRunDate, formatRunDuration } from "../lib/run-dashboard.js";
import { CopyButton } from "./copy-button.js";
import { RunLiveRefresh } from "./run-live-refresh.js";
import {
  Alert,
  AppShell,
  Breadcrumbs,
  Definition,
  DefinitionGrid,
  EmptyState,
  humanize,
  Pagination,
  Panel,
  StatusBadge,
} from "./ui.js";

export type RunView = "artifacts" | "attempts" | "audit" | "findings" | "publication" | "summary";

const navigationItems: ReadonlyArray<{ view: RunView; label: string; suffix: string }> = [
  { view: "summary", label: "Summary", suffix: "" },
  { view: "attempts", label: "Attempts", suffix: "/attempts" },
  { view: "findings", label: "Findings", suffix: "/findings" },
  { view: "artifacts", label: "Artifacts", suffix: "/artifacts" },
  { view: "publication", label: "Publication", suffix: "/publication" },
  { view: "audit", label: "Audit", suffix: "/audit" },
];

function RunNavigation({ runId, active }: Readonly<{ runId: string; active: RunView }>) {
  return (
    <nav className="run-navigation" aria-label="Run investigation">
      <ul>
        {navigationItems.map((item) => (
          <li key={item.view}>
            <Link href={`/runs/${runId}${item.suffix}`} aria-current={active === item.view ? "page" : undefined}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function RunHeader({ run }: Readonly<{ run: RunDetail }>) {
  return (
    <header className="run-header">
      <div className="run-header-copy">
        <p className="run-context">Evidence control room</p>
        <p className="run-repository-kind">{run.repositoryPrivate ? "Private repository" : "Public repository"}</p>
        <h1>{run.repository}</h1>
        <p className="run-subtitle">
          Run <code>{run.id}</code> · commit <code>{run.commitSha.slice(0, 12)}</code>
        </p>
      </div>
      <fieldset className="run-header-status">
        <legend className="sr-only">Run status summary</legend>
        <div className="score">
          <strong>{run.readinessScore ?? "—"}</strong>
          <span>Readiness score</span>
          <span className="sr-only">
            {run.readinessScore === undefined
              ? "Readiness score unavailable"
              : `Readiness score ${run.readinessScore} out of 100`}
          </span>
        </div>
        <StatusBadge value={run.decision} label={`Decision: ${humanize(run.decision)}`} />
        <StatusBadge value={run.status} />
      </fieldset>
    </header>
  );
}

export function RunPageFrame({
  run,
  active,
  children,
  liveRefresh,
}: Readonly<{ run: RunDetail; active: RunView; children: ReactNode; liveRefresh?: boolean }>) {
  const currentLabel = navigationItems.find((item) => item.view === active)?.label ?? "Run";
  return (
    <AppShell>
      <main className="shell" id="main-content">
        <Breadcrumbs
          items={[
            { href: "/", label: "BoardReadyOps" },
            { href: `/runs/${run.id}`, label: run.repository },
            { label: currentLabel },
          ]}
        />
        <RunHeader run={run} />
        {liveRefresh ? <RunLiveRefresh enabled /> : null}
        <RunNavigation runId={run.id} active={active} />
        <RunStateNotice run={run} />
        <div className="page-content">{children}</div>
      </main>
    </AppShell>
  );
}

export function RunUnavailable({ runId }: Readonly<{ runId: string }>) {
  return (
    <AppShell>
      <main className="shell compact-shell" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "BoardReadyOps" }, { label: "Run unavailable" }]} />
        <Alert title="Run dashboard is not configured" tone="warning">
          <p>
            This deployment cannot load run <code>{runId}</code> because its PostgreSQL connection is not configured.
          </p>
          <p>Configure the cloud database and retry. No run data was inferred or cached by this page.</p>
        </Alert>
      </main>
    </AppShell>
  );
}

export function RunStateNotice({ run }: Readonly<{ run: RunDetail }>) {
  if (run.investigationState === "dead_letter") {
    return (
      <Alert title="Recovery requires operator action" tone="danger">
        <p>
          {run.deadLetterCount} reconciliation item{run.deadLetterCount === 1 ? " is" : "s are"} in dead-letter state.
          The visible result is preserved, but automated recovery has stopped for those items.
        </p>
        <Link href={`/runs/${run.id}/audit`}>Open audit and recovery guidance</Link>
      </Alert>
    );
  }
  if (run.investigationState === "partial_data") {
    return (
      <Alert title="This run has partial data" tone="warning">
        <p>
          The logical run is terminal, but no accepted versioned result contract is attached. GitHub workflow evidence
          remains authoritative while the publication gap is investigated.
        </p>
        <Link href={`/runs/${run.id}/publication`}>Review publication state</Link>
      </Alert>
    );
  }
  if (run.investigationState === "reconciliation") {
    return (
      <Alert title="Reconciliation is active" tone="warning">
        <p>
          {run.reconciliationCount} recovery item{run.reconciliationCount === 1 ? " is" : "s are"} checking external and
          durable state. The current run result remains visible while recovery converges.
        </p>
        <Link href={`/runs/${run.id}/attempts`}>Review attempts and lifecycle transitions</Link>
      </Alert>
    );
  }
  if (run.investigationState === "stale") {
    return (
      <Alert title="This run may be stale" tone="warning">
        <p>The run is non-terminal and has not recorded activity for more than 15 minutes.</p>
        <Link href={`/runs/${run.id}/attempts`}>Inspect the execution timeline</Link>
      </Alert>
    );
  }
  if (run.investigationState === "failed" || run.investigationState === "timed_out") {
    return (
      <Alert title={run.investigationState === "timed_out" ? "Run timed out" : "Run failed"} tone="danger">
        <p>Review the latest attempt and blocking findings before retrying or approving a release.</p>
        <Link href={`/runs/${run.id}/attempts`}>Open attempt diagnostics</Link>
      </Alert>
    );
  }
  if (run.investigationState === "superseded") {
    return (
      <Alert title="A newer run superseded this result" tone="neutral">
        <p>This page remains historical evidence. Use the latest Check Run for the authoritative release decision.</p>
      </Alert>
    );
  }
  return null;
}

function githubRepositoryBaseUrl(run: RunDetail): string {
  const [owner = "", repository = ""] = run.repository.split("/", 2);
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
}

function SummaryDecisionAction({ runId, blockingCount }: Readonly<{ runId: string; blockingCount: number }>) {
  if (blockingCount > 0) {
    return (
      <Link className="button button-primary" href={`/runs/${runId}/findings?findingState=active&findingSort=severity`}>
        Review {blockingCount} blocking finding{blockingCount === 1 ? "" : "s"}
      </Link>
    );
  }
  return (
    <Link className="button button-primary" href={`/runs/${runId}/artifacts`}>
      Verify release evidence
    </Link>
  );
}

export function SummaryView({ run }: Readonly<{ run: RunDetail }>) {
  const blockingFindings = run.findings.filter(
    (finding) => ["critical", "error", "high"].includes(finding.severity.toLowerCase()) && !finding.waivedAt,
  );
  const latestWorkflowRunUrl = run.attempts.find((attempt) => attempt.workflowRunUrl)?.workflowRunUrl;
  return (
    <>
      <Panel
        id="decision"
        title="Release decision"
        description="The current normalized decision and the shortest next action."
      >
        <div className="decision-layout">
          <div className="decision-primary">
            <StatusBadge value={run.decision ?? run.conclusion ?? run.status} />
            <p className="decision-copy">{decisionCopy(run, blockingFindings.length)}</p>
          </div>
          <div className="decision-actions">
            <SummaryDecisionAction runId={run.id} blockingCount={blockingFindings.length} />
            <Link className="button button-secondary" href={`/runs/${run.id}/attempts`}>
              Inspect execution
            </Link>
          </div>
        </div>
      </Panel>

      <Panel title="Run summary" description="Repository, source, execution, and result metadata." id="summary">
        <DefinitionGrid>
          <Definition label="Status">
            <StatusBadge value={run.status} />
          </Definition>
          <Definition label="Decision">
            <StatusBadge value={run.decision} />
          </Definition>
          <Definition label="Conclusion">
            <StatusBadge value={run.conclusion} />
          </Definition>
          <Definition label="Trigger">{humanize(run.triggerKind)}</Definition>
          <Definition label="Pull request">
            {run.pullRequestNumber ? `#${run.pullRequestNumber}` : "Not a pull request"}
          </Definition>
          <Definition label="Started">{formatRunDate(run.startedAt)}</Definition>
          <Definition label="Completed">{formatRunDate(run.completedAt)}</Definition>
          <Definition label="Duration">{formatRunDuration(run.durationMs)}</Definition>
          <Definition label="Last activity">{formatRunDate(run.lastActivityAt)}</Definition>
        </DefinitionGrid>
      </Panel>

      <Panel
        title="Source and runtime"
        description="Exact source identity and tool versions used by the result."
        id="source"
      >
        <DefinitionGrid>
          <Definition label="Commit">
            <code>{run.commitSha}</code>
          </Definition>
          <Definition label="Ref">
            <code>{run.ref}</code>
          </Definition>
          <Definition label="Check Run">
            {run.githubCheckRunId ? <code>{run.githubCheckRunId}</code> : "Not recorded"}
          </Definition>
          <Definition label="Result contract">
            {run.resultContractVersion ? `v${run.resultContractVersion}` : "Not reported"}
          </Definition>
          <Definition label="BoardReadyOps">{run.boardReadyOpsVersion ?? "Not reported"}</Definition>
          <Definition label="KiCad">{run.kicadVersion ?? "Not reported"}</Definition>
          <Definition label="Trust mode">{humanize(run.trustMode)}</Definition>
          <Definition label="Safe-mode reasons">
            {run.safeModeReasons.length > 0 ? run.safeModeReasons.map(humanize).join(" · ") : "None"}
          </Definition>
          <Definition label="Policy preset">
            {run.setupPreset
              ? `${humanize(run.setupPreset)} v${run.setupPresetVersion ?? "?"} · revision ${run.setupRevision ?? "?"}`
              : "Not recorded"}
          </Definition>
          <Definition label="Setup readiness">
            {run.setupWorkflowStatus || run.setupConfigStatus
              ? `Workflow ${humanize(run.setupWorkflowStatus ?? "unknown")} · config ${humanize(run.setupConfigStatus ?? "unknown")}`
              : "Not recorded"}
          </Definition>
          <Definition label="Workflow contract">
            {run.setupWorkflowContractVersion ? `v${run.setupWorkflowContractVersion}` : "Not recorded"}
          </Definition>
        </DefinitionGrid>
        <nav className="source-links" aria-label="Authoritative GitHub sources">
          <a href={`${githubRepositoryBaseUrl(run)}/commit/${encodeURIComponent(run.commitSha)}`}>Open source commit</a>
          <a href={`${githubRepositoryBaseUrl(run)}/commit/${encodeURIComponent(run.commitSha)}/checks`}>
            Open GitHub checks
          </a>
          {latestWorkflowRunUrl ? <a href={latestWorkflowRunUrl}>Open GitHub Actions run</a> : null}
          {run.pullRequestNumber ? (
            <a href={`${githubRepositoryBaseUrl(run)}/pull/${run.pullRequestNumber}`}>
              Open pull request #{run.pullRequestNumber}
            </a>
          ) : null}
        </nav>
      </Panel>

      <div className="summary-grid">
        <Panel
          title="Findings"
          description={`${run.findingsPage.total} matching finding${run.findingsPage.total === 1 ? "" : "s"}.`}
          actions={<Link href={`/runs/${run.id}/findings`}>View all</Link>}
        >
          {run.findings.length === 0 ? (
            <EmptyState title="No findings">
              <p>The current result contains no matching findings.</p>
            </EmptyState>
          ) : (
            <ul className="compact-list">
              {run.findings.slice(0, 5).map((finding) => (
                <li key={finding.id}>
                  <div>
                    <strong>{finding.ruleId}</strong>
                    <StatusBadge value={finding.severity} />
                  </div>
                  <p>{finding.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          title="Artifacts"
          description={`${run.artifactsPage.total} matching artifact${run.artifactsPage.total === 1 ? "" : "s"}.`}
          actions={<Link href={`/runs/${run.id}/artifacts`}>View all</Link>}
        >
          {run.artifacts.length === 0 ? (
            <EmptyState title="No artifacts">
              <p>No managed artifact metadata is attached to this run.</p>
            </EmptyState>
          ) : (
            <ul className="compact-list">
              {run.artifacts.slice(0, 5).map((artifact) => (
                <li key={artifact.id}>
                  <div>
                    <strong>{artifact.name}</strong>
                    <StatusBadge value={artifact.availability} />
                  </div>
                  <p>
                    {artifact.kind} · {formatArtifactBytes(artifact.bytes)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

function decisionCopy(run: RunDetail, blockingCount: number): string {
  if (run.decision === "pass" || run.conclusion === "success") {
    return "The normalized result is ready for evidence review. Verify the authoritative artifacts and workflow source before release.";
  }
  if (blockingCount > 0) {
    return `${blockingCount} active high-severity finding${blockingCount === 1 ? " blocks" : "s block"} release readiness.`;
  }
  if (run.investigationState === "current" || run.investigationState === "reconciliation") {
    return "The run is still converging. Follow the execution timeline before making a release decision.";
  }
  return "The current result is not release-ready. Inspect attempts, findings, and publication state for the stable failure reason.";
}

export function AttemptTimeline({ attempts }: Readonly<{ attempts: AttemptDetail[] }>) {
  if (attempts.length === 0) {
    return (
      <EmptyState title="No execution attempt">
        <p>No worker or target workflow has claimed this run.</p>
      </EmptyState>
    );
  }
  return (
    <ol className="timeline">
      {attempts.map((attempt) => (
        <li key={attempt.id}>
          <div className="timeline-marker" aria-hidden="true" />
          <article>
            <header>
              <h3>Attempt {attempt.attemptNumber}</h3>
              <StatusBadge value={attempt.status} />
            </header>
            <DefinitionGrid>
              <Definition label="Created">{formatRunDate(attempt.createdAt)}</Definition>
              <Definition label="Dispatched">{formatRunDate(attempt.dispatchedAt)}</Definition>
              <Definition label="Started">{formatRunDate(attempt.startedAt)}</Definition>
              <Definition label="Heartbeat">{formatRunDate(attempt.heartbeatAt)}</Definition>
              <Definition label="Completed">{formatRunDate(attempt.completedAt)}</Definition>
              <Definition label="Retry after">{formatRunDate(attempt.retryAfterAt)}</Definition>
            </DefinitionGrid>
            {attempt.workflowDispatchId ? (
              <p>
                Workflow run: <code>{attempt.workflowDispatchId}</code>
                {attempt.workflowRunUrl ? (
                  <>
                    {" · "}
                    <a href={attempt.workflowRunUrl}>Open workflow logs and artifacts</a>
                  </>
                ) : null}
              </p>
            ) : null}
            {attempt.failureClass || attempt.failureMessage ? (
              <Alert title={attempt.failureClass ? humanize(attempt.failureClass) : "Attempt failed"} tone="danger">
                <p>{attempt.failureMessage ?? "The attempt reached a failed terminal state."}</p>
              </Alert>
            ) : null}
          </article>
        </li>
      ))}
    </ol>
  );
}

export function AttemptsView({ run }: Readonly<{ run: RunDetail }>) {
  return (
    <>
      <Panel
        title="Execution attempts"
        description="Newest attempts first, bounded to the latest 50 records."
        id="attempts"
      >
        <AttemptTimeline attempts={run.attempts} />
      </Panel>

      <Panel
        title="Lifecycle transitions"
        description="Privacy-bounded transition evidence, newest first and limited to 100 records."
        id="transitions"
      >
        {run.transitions.length === 0 ? (
          <EmptyState title="No lifecycle transitions">
            <p>Older runs may not have versioned transition evidence.</p>
          </EmptyState>
        ) : (
          <ol className="transition-list">
            {run.transitions.map((transition) => (
              <li
                key={`${transition.entityType}:${transition.executionAttemptId ?? "run"}:${transition.toVersion}:${transition.occurredAt}`}
              >
                <div>
                  <strong>{transition.entityType === "release_run" ? "Logical run" : "Execution attempt"}</strong>
                  <StatusBadge value={transition.reasonCode} />
                </div>
                <p>
                  <code>{transition.fromStatus}</code> to <code>{transition.toStatus}</code> · version{" "}
                  {transition.fromVersion} to {transition.toVersion}
                </p>
                {transition.executionAttemptId ? (
                  <p>
                    Attempt <code>{transition.executionAttemptId}</code>
                  </p>
                ) : null}
                <time dateTime={transition.occurredAt}>{formatRunDate(transition.occurredAt)}</time>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </>
  );
}

export type SearchParameterMap = Readonly<Record<string, string | string[] | undefined>>;
type FindingGroup = "kind" | "none" | "path" | "rule" | "severity";

function firstParameter(parameters: SearchParameterMap, name: string): string | undefined {
  const value = parameters[name];
  return Array.isArray(value) ? value[0] : value;
}

export function filtersFromSearchParameters(parameters: SearchParameterMap): RunDashboardFilters {
  const findingsPage = Number(firstParameter(parameters, "findingsPage"));
  const artifactsPage = Number(firstParameter(parameters, "artifactsPage"));
  const findingState = firstParameter(parameters, "findingState");
  const findingSort = firstParameter(parameters, "findingSort");
  const findingGroup = firstParameter(parameters, "findingGroup");
  const artifactSort = firstParameter(parameters, "artifactSort");
  const findingSearch = firstParameter(parameters, "findingSearch");
  const findingSeverity = firstParameter(parameters, "findingSeverity");
  const artifactSearch = firstParameter(parameters, "artifactSearch");
  const artifactRole = firstParameter(parameters, "artifactRole");
  const artifactKind = firstParameter(parameters, "artifactKind");
  return {
    ...(findingSearch ? { findingSearch } : {}),
    ...(findingSeverity ? { findingSeverity } : {}),
    findingState: findingState === "active" || findingState === "waived" ? findingState : "all",
    findingSort: findingSort === "path" || findingSort === "rule" ? findingSort : "severity",
    findingGroup:
      findingGroup === "kind" || findingGroup === "path" || findingGroup === "rule" || findingGroup === "severity"
        ? findingGroup
        : "none",
    findingsPage: Number.isSafeInteger(findingsPage) && findingsPage > 0 ? findingsPage : 1,
    ...(artifactSearch ? { artifactSearch } : {}),
    ...(artifactRole ? { artifactRole } : {}),
    ...(artifactKind ? { artifactKind } : {}),
    artifactSort: artifactSort === "name" || artifactSort === "size" ? artifactSort : "newest",
    artifactsPage: Number.isSafeInteger(artifactsPage) && artifactsPage > 0 ? artifactsPage : 1,
  };
}

function stringSearchParameters(parameters: SearchParameterMap): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(parameters).map(([name, value]) => [name, Array.isArray(value) ? value[0] : value]),
  );
}

function findingGroupValue(finding: FindingDetail, group: FindingGroup): string {
  if (group === "severity") return humanize(finding.severity);
  if (group === "rule") return finding.ruleId;
  if (group === "kind") return finding.kind ? humanize(finding.kind) : "Kind not reported";
  if (group === "path") return finding.path ?? "Path not reported";
  return "All findings";
}

export function FindingList({
  findings,
  group = "none",
}: Readonly<{ findings: FindingDetail[]; group?: FindingGroup }>) {
  if (findings.length === 0) {
    return (
      <EmptyState title="No matching findings">
        <p>Change the filters or return to the full findings list.</p>
      </EmptyState>
    );
  }
  if (group === "none") {
    return (
      <ul className="finding-list">
        {findings.map((finding) => (
          <FindingRow key={finding.id} finding={finding} />
        ))}
      </ul>
    );
  }
  const groups = new Map<string, FindingDetail[]>();
  for (const finding of findings) {
    const label = findingGroupValue(finding, group);
    groups.set(label, [...(groups.get(label) ?? []), finding]);
  }
  return (
    <div className="finding-groups">
      {[...groups.entries()].map(([label, entries]) => (
        <section key={label} className="finding-group" aria-labelledby={`finding-group-${safeDomId(label)}`}>
          <header>
            <h3 id={`finding-group-${safeDomId(label)}`}>{label}</h3>
            <span className="finding-group-count">{entries.length} on this page</span>
          </header>
          <ul className="finding-list">
            {entries.map((finding) => (
              <FindingRow key={finding.id} finding={finding} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function safeDomId(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 64) || "other"
  );
}

export function FindingsView({
  run,
  searchParameters,
}: Readonly<{ run: RunDetail; searchParameters: SearchParameterMap }>) {
  const current = stringSearchParameters(searchParameters);
  const group = filtersFromSearchParameters(searchParameters).findingGroup ?? "none";
  return (
    <Panel
      title="Findings"
      description="Search, filter, group, sort, and page through normalized findings without loading the complete result set."
      id="findings"
    >
      <form className="filter-bar" method="get" action={`/runs/${run.id}/findings`}>
        <label>
          <span>Search findings</span>
          <input
            name="findingSearch"
            type="search"
            maxLength={128}
            defaultValue={current.findingSearch}
            placeholder="Rule, message, or path"
          />
        </label>
        <label>
          <span>Severity</span>
          <select name="findingSeverity" defaultValue={current.findingSeverity ?? ""}>
            <option value="">All severities</option>
            {["critical", "error", "high", "medium", "warning", "low", "info"].map((severity) => (
              <option key={severity} value={severity}>
                {humanize(severity)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Waiver state</span>
          <select name="findingState" defaultValue={current.findingState ?? "all"}>
            <option value="all">All findings</option>
            <option value="active">Active only</option>
            <option value="waived">Waived only</option>
          </select>
        </label>
        <label>
          <span>Group</span>
          <select name="findingGroup" defaultValue={current.findingGroup ?? "none"}>
            <option value="none">No grouping</option>
            <option value="severity">Severity</option>
            <option value="rule">Rule ID</option>
            <option value="kind">Kind</option>
            <option value="path">Path</option>
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select name="findingSort" defaultValue={current.findingSort ?? "severity"}>
            <option value="severity">Severity</option>
            <option value="rule">Rule ID</option>
            <option value="path">Path</option>
          </select>
        </label>
        <div className="filter-actions">
          <button className="button button-primary" type="submit">
            Apply filters
          </button>
          <Link className="button button-secondary" href={`/runs/${run.id}/findings`}>
            Reset
          </Link>
        </div>
      </form>
      <p className="result-count" aria-live="polite">
        {run.findingsPage.total} matching finding{run.findingsPage.total === 1 ? "" : "s"}
      </p>
      <FindingList findings={run.findings} group={group} />
      <Pagination
        basePath={`/runs/${run.id}/findings`}
        page={run.findingsPage.page}
        totalPages={run.findingsPage.totalPages}
        pageParameter="findingsPage"
        searchParameters={current}
      />
    </Panel>
  );
}

function FindingRow({ finding }: Readonly<{ finding: FindingDetail }>) {
  return (
    <li>
      <header>
        <div>
          <strong>{finding.ruleId}</strong>
          <StatusBadge value={finding.severity} />
        </div>
        <StatusBadge value={finding.waivedAt ? "waived" : "active"} />
      </header>
      <p>{finding.message}</p>
      <dl className="inline-definitions">
        <div>
          <dt>Path</dt>
          <dd>{finding.path ? <code>{finding.path}</code> : "Not reported"}</dd>
        </div>
        <div>
          <dt>Kind</dt>
          <dd>{finding.kind ? humanize(finding.kind) : "Not reported"}</dd>
        </div>
        <div>
          <dt>Waived</dt>
          <dd>{formatRunDate(finding.waivedAt)}</dd>
        </div>
      </dl>
    </li>
  );
}

export function ArtifactTable({ artifacts }: Readonly<{ artifacts: ArtifactDetail[] }>) {
  if (artifacts.length === 0) {
    return (
      <EmptyState title="No matching artifacts">
        <p>No current artifact metadata matches these filters.</p>
      </EmptyState>
    );
  }
  return (
    <section className="table-scroll" aria-label="Artifact evidence table">
      <table className="artifact-table">
        <thead>
          <tr>
            <th scope="col">Artifact</th>
            <th scope="col">Status</th>
            <th scope="col">Checksum</th>
            <th scope="col">Size</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {artifacts.map((artifact) => (
            <ArtifactRow key={artifact.id} artifact={artifact} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function ArtifactsView({
  run,
  searchParameters,
}: Readonly<{ run: RunDetail; searchParameters: SearchParameterMap }>) {
  const current = stringSearchParameters(searchParameters);
  const normalizedArtifactSort = filtersFromSearchParameters(searchParameters).artifactSort ?? "newest";
  const hasUnavailableSignedDownload = run.artifacts.some((artifact) => !artifact.downloadUrl);
  const artifactLifecycleTotal =
    run.artifactLifecycle.deleted +
    run.artifactLifecycle.missing +
    run.artifactLifecycle.pendingDeletion +
    run.artifactLifecycle.failedDeletion;
  const artifactLifecycleTone =
    run.artifactLifecycle.failedDeletion > 0
      ? ("danger" as const)
      : run.artifactLifecycle.pendingDeletion > 0
        ? ("warning" as const)
        : ("info" as const);
  const latestWorkflowRunUrl = run.attempts.find((attempt) => attempt.workflowRunUrl)?.workflowRunUrl;
  return (
    <Panel
      title="Artifacts"
      description="Authoritative checksums, availability, retention responsibility, and bounded download access."
      id="artifacts"
      actions={
        latestWorkflowRunUrl ? (
          <a href={latestWorkflowRunUrl}>Open repository-owned GitHub Actions artifacts</a>
        ) : undefined
      }
    >
      <form className="filter-bar artifact-filter-bar" method="get" action={`/runs/${run.id}/artifacts`}>
        <label>
          <span>Search artifacts</span>
          <input
            name="artifactSearch"
            type="search"
            maxLength={128}
            defaultValue={current.artifactSearch}
            placeholder="Name, kind, or checksum"
          />
        </label>
        <label>
          <span>Role</span>
          <input
            name="artifactRole"
            maxLength={128}
            pattern="[A-Za-z0-9][A-Za-z0-9._:-]{0,127}"
            defaultValue={current.artifactRole}
            placeholder="manufacturing"
          />
        </label>
        <label>
          <span>Type</span>
          <input
            name="artifactKind"
            maxLength={128}
            pattern="[A-Za-z0-9][A-Za-z0-9._:-]{0,127}"
            defaultValue={current.artifactKind}
            placeholder="report"
          />
        </label>
        <label>
          <span>Sort</span>
          <select name="artifactSort" defaultValue={normalizedArtifactSort}>
            <option value="newest">Newest first</option>
            <option value="name">Name</option>
            <option value="size">Largest first</option>
          </select>
        </label>
        <div className="filter-actions">
          <button className="button button-primary" type="submit">
            Apply filters
          </button>
          <Link className="button button-secondary" href={`/runs/${run.id}/artifacts`}>
            Reset
          </Link>
        </div>
      </form>
      {hasUnavailableSignedDownload ? (
        <Alert title="Signed artifact download is unavailable" tone="warning">
          <p>The artifact is recorded as available, but this deployment cannot issue a signed download URL.</p>
        </Alert>
      ) : null}
      {artifactLifecycleTotal > 0 ? (
        <Alert title="Artifact lifecycle history" tone={artifactLifecycleTone}>
          <p>
            Run-wide counts come from durable artifact deletion jobs. Replaced artifact metadata is removed before
            physical deletion; these counts do not imply an automatic age-based expiry policy.
          </p>
          <DefinitionGrid>
            <Definition label="Deleted objects">{run.artifactLifecycle.deleted}</Definition>
            <Definition label="Already missing">{run.artifactLifecycle.missing}</Definition>
            <Definition label="Deletion pending">{run.artifactLifecycle.pendingDeletion}</Definition>
            <Definition label="Deletion failed">{run.artifactLifecycle.failedDeletion}</Definition>
          </DefinitionGrid>
        </Alert>
      ) : null}
      <p className="result-count" aria-live="polite">
        {run.artifactsPage.total} matching artifact{run.artifactsPage.total === 1 ? "" : "s"}
      </p>
      <ArtifactTable artifacts={run.artifacts} />
      <Pagination
        basePath={`/runs/${run.id}/artifacts`}
        page={run.artifactsPage.page}
        totalPages={run.artifactsPage.totalPages}
        pageParameter="artifactsPage"
        searchParameters={current}
      />
    </Panel>
  );
}

function ArtifactRow({ artifact }: Readonly<{ artifact: ArtifactDetail }>) {
  return (
    <tr>
      <th scope="row">
        <strong>{artifact.name}</strong>
        <span>
          {humanize(artifact.kind)} · {humanize(artifact.role)} · {artifact.contentType}
        </span>
        <time dateTime={artifact.uploadedAt}>{formatRunDate(artifact.uploadedAt)}</time>
      </th>
      <td>
        <StatusBadge value={artifact.availability} />
        <span className="cell-note">
          {artifact.retentionUntil
            ? `Retention recorded until ${formatRunDate(artifact.retentionUntil)}`
            : "Retention: no automatic age-based expiry"}
        </span>
        {artifact.executionAttemptId ? <span className="cell-note">Attempt: {artifact.executionAttemptId}</span> : null}
      </td>
      <td>
        <code className="checksum">{artifact.sha256}</code>
        <CopyButton label="Copy SHA-256" value={artifact.sha256} />
      </td>
      <td>{formatArtifactBytes(artifact.bytes)}</td>
      <td>
        {artifact.downloadUrl ? (
          <a className="button button-secondary button-compact" href={artifact.downloadUrl}>
            Download signed copy
          </a>
        ) : (
          <span>Signed download unavailable</span>
        )}
      </td>
    </tr>
  );
}

export function PublicationView({ run }: Readonly<{ run: RunDetail }>) {
  return (
    <>
      <Panel
        title="Publication status"
        description="When normalized evidence was published to GitHub surfaces."
        id="publication"
      >
        <DefinitionGrid>
          <Definition label="Last publication attempt">{formatRunDate(run.lastPublicationAttemptAt)}</Definition>
          <Definition label="Check Run published">{formatRunDate(run.githubCheckPublishedAt)}</Definition>
          <Definition label="PR comment published">{formatRunDate(run.githubCommentPublishedAt)}</Definition>
          <Definition label="Check Run ID">
            {run.githubCheckRunId ? <code>{run.githubCheckRunId}</code> : "Not recorded"}
          </Definition>
        </DefinitionGrid>
        {run.lastPublicationError ? (
          <Alert title="Last publication failed" tone="danger">
            <p>{run.lastPublicationError}</p>
          </Alert>
        ) : null}
      </Panel>
      <Panel title="Metrics" description="Numeric metrics accepted by the versioned result contract." id="metrics">
        {Object.keys(run.metrics).length === 0 ? (
          <EmptyState title="No metrics">
            <p>The runner did not report numeric metrics for this result.</p>
          </EmptyState>
        ) : (
          <DefinitionGrid>
            {Object.entries(run.metrics)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([name, value]) => (
                <Definition key={name} label={name}>
                  {value}
                </Definition>
              ))}
          </DefinitionGrid>
        )}
      </Panel>
      <Panel
        title="Authoritative report links"
        description="HTTPS links supplied by the accepted runner result."
        id="reports"
      >
        {run.reportLinks.length === 0 ? (
          <EmptyState title="No report links">
            <p>Use the Check Run and repository-owned workflow output as the authoritative source.</p>
          </EmptyState>
        ) : (
          <ul className="link-list">
            {run.reportLinks.map((report) => (
              <li key={`${report.label}:${report.url}`}>
                <a href={report.url}>{report.label}</a>
                <span className="link-host">{new URL(report.url).hostname}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

export function AuditView({ run }: Readonly<{ run: RunDetail }>) {
  return (
    <>
      <Panel
        title="Audit and recovery evidence"
        description="Privacy-bounded operational records are separated from customer-facing run content."
        id="audit"
      >
        <Alert title="Operator authentication required" tone="info">
          <p>
            Audit events are available through the tenant-scoped operator API and are not embedded in this public run
            route.
          </p>
        </Alert>
        <DefinitionGrid>
          <Definition label="Installation scope">Derived from the repository tenant boundary</Definition>
          <Definition label="Run filter">
            <code>{run.id}</code>
          </Definition>
          <Definition label="Reconciliation backlog">{run.reconciliationCount}</Definition>
          <Definition label="Export surface">
            <code>/api/v1/operator/installations/&lt;installationId&gt;/audit-events?releaseRunId={run.id}</code>
          </Definition>
        </DefinitionGrid>
      </Panel>
      <Panel
        title="What is intentionally excluded"
        description="The audit export minimizes sensitive content."
        id="audit-boundary"
      >
        <ul className="check-list">
          <li>Raw source and GitHub webhook bodies</li>
          <li>Finding messages and repository-relative paths</li>
          <li>Artifact names and internal storage paths</li>
          <li>Credentials, bearer values, cookies, and request secrets</li>
        </ul>
      </Panel>
    </>
  );
}
