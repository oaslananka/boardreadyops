import Link from "next/link";
import { GuidedChecklist } from "../../components/guided-checklist.js";
import { ReviewEmptyVisualPreview } from "../../components/review/review-empty-visual-preview.js";
import { type DataColumn, DataTable } from "../../components/ui/data-table.js";
import { AppShell, Panel, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { repositoriesRequiringReview } from "../../lib/dashboard-next-action.js";
import {
  type DashboardRepositorySummary,
  loadViewerRepositories,
  type RepositoryGroup,
  summarizeViewerRepositories,
} from "../../lib/repository-dashboard.js";
import { viewerAuthorization } from "../../lib/viewer-authorization.js";

export const metadata = {
  title: "Dashboard",
  description: "Repositories BoardReadyOps is watching, their latest release readiness, and open findings.",
};

function when(value: string | undefined): string {
  if (!value) return "never";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "unknown" : new Date(parsed).toISOString().replace("T", " ").slice(0, 16);
}

function SignInRequiredPanel() {
  return (
    <Panel title="Sign in required">
      <p className="text-sm text-muted-foreground">
        BoardReadyOps shows the repositories your GitHub App installations can access, so it needs to know who you are.
      </p>
    </Panel>
  );
}

function NoRepositoriesPanel() {
  return (
    <GuidedChecklist
      heading="Get your first board reviewed — 2 steps left"
      steps={[
        { id: "install", label: "Connect the BoardReadyOps GitHub App", status: "done" },
        {
          id: "link",
          label: "Link a repository with a hardware project",
          status: "current",
          href: "/setup",
          actionLabel: "Start",
        },
        { id: "pr", label: "Open a pull request to trigger the first run", status: "upcoming" },
      ]}
    />
  );
}

function OperationalSummarySection({ summary }: Readonly<{ summary: DashboardRepositorySummary }>) {
  return (
    <section aria-labelledby="operational-summary-heading" className="rounded-md border border-border p-4">
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Engineering activity and recorded supply monitoring
        </summary>
        <header className="mb-4 mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Current scope</p>
          <h2 id="operational-summary-heading" className="text-lg font-bold text-foreground">
            Engineering status
          </h2>
        </header>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {(
            [
              ["Repositories", summary.repositories],
              ["Repositories with findings", summary.repositoriesWithOpenFindings],
              ["Supply alerts (recorded)", summary.supplyAlerts],
              ["No run yet", summary.repositoriesWithoutRuns],
              ["Supply-tracked boards", summary.watchedBoards],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-2xl font-bold text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Recorded supply alerts only: these are stored findings, not a live risk assessment. No stored alerts does not
          prove that supply monitoring is enabled or that components are risk-free. Supply-tracked boards counts
          registered component-monitoring records, not GitHub readiness runs. A zero does not mean your connected
          repositories have stopped being checked.
        </p>
      </details>
    </section>
  );
}

function FindingsAttentionBanner({
  summary,
  groups,
}: Readonly<{ summary: DashboardRepositorySummary; groups: RepositoryGroup[] }>) {
  const affected = repositoriesRequiringReview(groups);
  const first = affected[0];
  if (affected.length === 0) {
    return (
      <section className="rounded-md border border-warning/40 bg-warning-surface px-5 py-4">
        <p className="text-xs font-bold uppercase text-warning">Supply findings recorded</p>
        <h2 className="mt-1 text-lg font-semibold">{summary.supplyAlerts} recorded supply alerts need review</h2>
        <p className="mt-1 text-sm text-muted-foreground">Stored findings are not a live supply-risk assessment.</p>
        <Link href="/parts" className="inline-flex min-h-11 items-center font-medium text-primary underline">
          Review supply alerts →
        </Link>
      </section>
    );
  }
  return (
    <section
      aria-label="Repositories requiring review"
      className="flex flex-col gap-3 rounded-md border border-warning/40 bg-warning-surface px-5 py-4"
    >
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-warning">Attention required</p>
        <h2 className="text-lg font-semibold text-foreground">
          {summary.repositoriesWithOpenFindings}{" "}
          {summary.repositoriesWithOpenFindings === 1 ? "repository needs" : "repositories need"} review
        </h2>
        <p className="text-sm text-muted-foreground">
          Showing the most recent recorded run with open findings first. Finding count is not a risk score.
        </p>
      </div>
      {first?.latestRunId ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="sr-only">Next action</span>
          <div className="min-w-0 text-sm">
            <strong className="block break-words text-foreground">
              {first.owner}/{first.name}
            </strong>
            <span className="text-muted-foreground">
              {first.openFindings} recorded open findings · {when(first.latestRunAt)}
            </span>
          </div>
          <Link
            href={`/runs/${first.latestRunId}/findings`}
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Review {first.openFindings} findings in {first.owner}/{first.name} →
          </Link>
        </div>
      ) : null}
      {affected.length > 1 ? (
        <div className="text-sm">
          <p className="font-medium text-foreground">Other repositories needing review</p>
          <ul className="mt-1 flex flex-col gap-1">
            {affected.slice(1, 4).map((repository) => (
              <li key={repository.id}>
                <Link
                  className="text-primary underline underline-offset-2"
                  href={`/runs/${repository.latestRunId}/findings`}
                >
                  {repository.owner}/{repository.name} · {repository.openFindings} findings
                </Link>
              </li>
            ))}
          </ul>
          {affected.length > 4 ? (
            <Link href="/runs" className="text-primary underline underline-offset-2">
              Browse all runs →
            </Link>
          ) : null}
        </div>
      ) : null}
      {summary.supplyAlerts > 0 ? (
        <p className="text-sm text-foreground">
          {summary.supplyAlerts} additional recorded supply alerts.{" "}
          <Link href="/parts" className="text-primary underline">
            Inspect parts →
          </Link>
        </p>
      ) : null}
    </section>
  );
}

function RecordedHardwareWork({ groups }: Readonly<{ groups: RepositoryGroup[] }>) {
  const recent = groups.flatMap((group) => group.repositories).filter((repository) => Boolean(repository.latestRunId));
  recent.sort((a, b) => {
    const date = (value: string | undefined) => {
      const parsed = value ? Date.parse(value) : Number.NaN;
      return Number.isNaN(parsed) ? 0 : parsed;
    };
    return date(b.latestRunAt) - date(a.latestRunAt) || `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`);
  });
  const attention = recent.filter((repository) => repository.openFindings > 0);
  const selected = [...attention, ...recent.filter((repository) => repository.openFindings === 0)].slice(0, 3);
  if (selected.length === 0) return null;

  return (
    <section aria-labelledby="recorded-hardware-work-heading" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Real repository activity</p>
          <h2 id="recorded-hardware-work-heading" className="font-display text-2xl font-semibold tracking-tight">
            Pick up your hardware work
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Latest recorded runs from your connected repositories. Finding counts are not severity ratings.
          </p>
        </div>
        <Link
          href="/runs"
          className="inline-flex min-h-10 items-center text-sm font-semibold text-primary hover:underline"
        >
          All runs →
        </Link>
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        {selected.map((repository) => {
          const hasFindings = repository.openFindings > 0;
          const url = hasFindings ? `/runs/${repository.latestRunId}/findings` : `/runs/${repository.latestRunId}`;
          return (
            <article
              key={repository.id}
              className="flex min-w-0 flex-col justify-between gap-4 rounded-xl border border-border bg-card p-5 shadow-e1 transition-[border-color,box-shadow] hover:border-primary/35 hover:shadow-e2"
            >
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {hasFindings ? "Findings to investigate" : "Recorded check"}
                  </span>
                  <StatusBadge value={repository.latestRunDecision ?? repository.latestRunStatus ?? "unknown"} />
                </div>
                <h3 className="break-words text-base font-semibold text-foreground">
                  {repository.owner}/{repository.name}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {hasFindings
                    ? `${repository.openFindings} open findings in the latest recorded run`
                    : "No open findings in the latest recorded run"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {repository.latestRunAt ? `Last run ${when(repository.latestRunAt)} UTC` : "Run date unavailable"}
                </p>
              </div>
              <Link
                href={url}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 text-sm font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {hasFindings ? "Inspect findings" : "Inspect run evidence"} <span aria-hidden="true">↗</span>
              </Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ExpandableExamplePreview() {
  return (
    <details className="overflow-hidden rounded-xl border border-border bg-card">
      <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-3 px-5 py-3 text-sm font-semibold text-foreground hover:bg-muted/35">
        <span>
          Explore a sample PCB and schematic <span className="font-normal text-muted-foreground">· Example only</span>
        </span>
        <span aria-hidden="true" className="text-primary">
          ⌄
        </span>
      </summary>
      <div className="border-t border-border p-3">
        <ReviewEmptyVisualPreview mode="onboarding" />
      </div>
    </details>
  );
}

function SetupInProgressBanner({ summary }: Readonly<{ summary: DashboardRepositorySummary }>) {
  return (
    <output className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-info/40 bg-info-surface px-5 py-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-info">Setup in progress</p>
        <strong className="text-sm font-semibold text-foreground">
          {summary.repositoriesWithoutRuns}{" "}
          {summary.repositoriesWithoutRuns === 1 ? "repository is" : "repositories are"} waiting for an initial release
          check.
        </strong>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="rounded-full bg-info/20 px-2 py-0.5 text-xs font-bold text-info">Next action</span>
        <Link href="/setup" className="font-medium text-info hover:underline">
          Review setup workflow and dispatch probe →
        </Link>
      </div>
    </output>
  );
}

function AttentionBanner({
  summary,
  groups,
}: Readonly<{ summary: DashboardRepositorySummary; groups: RepositoryGroup[] }>) {
  if (summary.repositoriesWithOpenFindings > 0 || summary.supplyAlerts > 0) {
    return <FindingsAttentionBanner summary={summary} groups={groups} />;
  }
  if (summary.repositoriesWithoutRuns > 0) {
    return <SetupInProgressBanner summary={summary} />;
  }
  return null;
}

type RepositoryRow = RepositoryGroup["repositories"][number];

const repositoryColumns: readonly DataColumn<RepositoryRow>[] = [
  {
    id: "repository",
    header: "Repository",
    rowHeader: true,
    cell: (repository) => (
      <>
        <Link href={`/repositories/${repository.id}`} className="text-primary hover:underline">
          {repository.owner}/{repository.name}
        </Link>
        {repository.private ? (
          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-micro text-muted-foreground">private</span>
        ) : undefined}
      </>
    ),
  },
  {
    id: "latest-run",
    header: "Latest run",
    cell: (repository) =>
      repository.latestRunId ? (
        <div className="flex items-center gap-2">
          <Link
            href={`/runs/${repository.latestRunId}`}
            className="inline-flex items-center gap-2 underline-offset-2 hover:underline"
            aria-label={`Open latest run for ${repository.owner}/${repository.name}`}
          >
            <StatusBadge value={repository.latestRunDecision ?? repository.latestRunStatus} />
            <span className="text-meta text-muted-foreground">{when(repository.latestRunAt)}</span>
          </Link>
        </div>
      ) : (
        <span className="text-meta text-muted-foreground">
          no runs yet ·{" "}
          <Link href="/setup" className="text-primary hover:underline">
            setup
          </Link>
        </span>
      ),
  },
  {
    id: "findings",
    header: "Findings",
    align: "end",
    cell: (repository) =>
      repository.latestRunId && repository.openFindings > 0 ? (
        <Link
          href={`/runs/${repository.latestRunId}/findings`}
          className="font-medium tabular-nums text-primary underline underline-offset-2"
          aria-label={`Review ${repository.openFindings} findings in ${repository.owner}/${repository.name}`}
        >
          {repository.openFindings}
        </Link>
      ) : (
        <span className="tabular-nums">{repository.latestRunId ? repository.openFindings : "—"}</span>
      ),
  },
  {
    id: "boards",
    header: "Supply-tracked boards",
    align: "end",
    cell: (repository) => <span className="tabular-nums">{repository.watchedBoards}</span>,
  },
  {
    id: "supply",
    header: "Supply alerts (recorded)",
    align: "end",
    cell: (repository) => <span className="tabular-nums">{repository.openSupplyFindings}</span>,
  },
];

function RepositorySections({ groups }: Readonly<{ groups: RepositoryGroup[] }>) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <Panel key={group.accountLogin} title={group.accountLogin} tone="section">
          <DataTable
            caption={`Repositories under ${group.accountLogin}`}
            columns={repositoryColumns}
            rows={group.repositories}
            rowKey={(repository) => repository.id}
            empty={<p className="text-sm text-muted-foreground">No repositories in this account yet.</p>}
          />
        </Panel>
      ))}
    </div>
  );
}

function DashboardBody({
  hasSession,
  groups,
  summary,
}: Readonly<{
  hasSession: boolean;
  groups: RepositoryGroup[];
  summary: DashboardRepositorySummary;
}>) {
  if (!hasSession) {
    return (
      <div className="flex flex-col gap-4">
        <ReviewEmptyVisualPreview
          mode="onboarding"
          actionHref="/api/auth/github/login"
          actionLabel="Sign in to connect a board"
        />
        <SignInRequiredPanel />
      </div>
    );
  }
  if (summary.repositories === 0) {
    return (
      <div className="flex flex-col gap-4">
        <ReviewEmptyVisualPreview mode="onboarding" actionLabel="Connect your first board" />
        <NoRepositoriesPanel />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <AttentionBanner summary={summary} groups={groups} />
      <RecordedHardwareWork groups={groups} />
      {summary.repositoriesWithoutRuns > summary.repositories / 2 ? <ExpandableExamplePreview /> : null}
      {summary.repositoriesWithOpenFindings === 0 &&
      summary.repositoriesWithoutRuns === 0 &&
      summary.supplyAlerts === 0 ? (
        <section className="rounded-md border border-border bg-card p-5" aria-label="Latest checks">
          <h2 className="text-lg font-semibold text-foreground">No open findings recorded in the latest runs</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This is not a live safety assessment or permission to fabricate. Open a run to inspect its exact source and
            evidence.
          </p>
          <Link
            href="/runs"
            className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary underline"
          >
            Inspect recorded readiness runs →
          </Link>
        </section>
      ) : null}
      {summary.repositories > 5 ? (
        <details className="rounded-xl border border-border bg-card" aria-label="All connected repositories">
          <summary className="min-h-12 cursor-pointer px-5 py-4 text-sm font-semibold hover:text-primary">
            Browse all {summary.repositories} connected repositories
          </summary>
          <div className="border-t border-border p-4">
            <RepositorySections groups={groups} />
          </div>
        </details>
      ) : (
        <RepositorySections groups={groups} />
      )}
      <OperationalSummarySection summary={summary} />
    </div>
  );
}

export default async function DashboardPage() {
  const viewer = await viewerAuthorization();
  const groups = await loadViewerRepositories(viewer.session);
  const summary = summarizeViewerRepositories(groups);

  return (
    <AppShell viewerNav={<ViewerNav />} breadcrumbs={[{ href: "/", label: "Home" }, { label: "Dashboard" }]}>
      <main id="main-content" className="flex flex-col gap-5 px-6 py-6">
        <header>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Repositories BoardReadyOps is watching, with the latest release readiness for each.
          </p>
        </header>
        <DashboardBody hasSession={Boolean(viewer.session)} groups={groups} summary={summary} />
      </main>
    </AppShell>
  );
}
