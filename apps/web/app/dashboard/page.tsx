import Link from "next/link";
import { GuidedChecklist } from "../../components/guided-checklist.js";
import { type DataColumn, DataTable } from "../../components/ui/data-table.js";
import { AppShell, Panel, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
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
    <section aria-labelledby="operational-summary-heading" className="rounded-md border border-border p-5">
      <header className="mb-4">
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
            ["Supply alerts", summary.supplyAlerts],
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
        Supply-tracked boards counts registered component-monitoring records, not GitHub readiness runs. A zero does not
        mean your connected repositories have stopped being checked.
      </p>
    </section>
  );
}

function FindingsAttentionBanner({
  summary,
  groups,
}: Readonly<{ summary: DashboardRepositorySummary; groups: RepositoryGroup[] }>) {
  const affected = groups
    .flatMap((group) => group.repositories)
    .find((repository) => repository.latestRunId && repository.openFindings > 0);
  return (
    <output className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning-surface px-5 py-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-warning">Attention required</p>
        <strong className="text-sm font-semibold text-foreground">
          {summary.repositoriesWithOpenFindings}{" "}
          {summary.repositoriesWithOpenFindings === 1 ? "repository has" : "repositories have"} open findings
          {summary.supplyAlerts > 0 ? ` and ${summary.supplyAlerts} supply alerts` : ""} before fabrication.
        </strong>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs font-bold text-warning">Next action</span>
        {affected?.latestRunId ? (
          <Link
            href={`/runs/${affected.latestRunId}/findings`}
            className="font-medium text-foreground underline underline-offset-2"
          >
            Review {affected.openFindings} findings in {affected.owner}/{affected.name} →
          </Link>
        ) : summary.supplyAlerts > 0 ? (
          <Link href="/parts" className="font-medium text-foreground underline underline-offset-2">
            Review supply alerts →
          </Link>
        ) : (
          <Link href="/runs" className="font-medium text-foreground underline underline-offset-2">
            Browse readiness runs →
          </Link>
        )}
      </div>
    </output>
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
    header: "Supply alerts",
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
  if (!hasSession) return <SignInRequiredPanel />;
  if (summary.repositories === 0) return <NoRepositoriesPanel />;

  return (
    <div className="flex flex-col gap-5">
      <OperationalSummarySection summary={summary} />
      <AttentionBanner summary={summary} groups={groups} />
      <RepositorySections groups={groups} />
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
