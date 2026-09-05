import Link from "next/link";
import { GuidedChecklist } from "../../components/guided-checklist.js";
import { AppShell, Breadcrumbs, Panel, StatusBadge } from "../../components/ui.js";
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
            ["Boards watched", summary.watchedBoards],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-2xl font-bold text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function FindingsAttentionBanner({ summary }: Readonly<{ summary: DashboardRepositorySummary }>) {
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
        <span className="text-muted-foreground">Inspect findings below and resolve blocking design violations.</span>
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

function AttentionBanner({ summary }: Readonly<{ summary: DashboardRepositorySummary }>) {
  if (summary.repositoriesWithOpenFindings > 0 || summary.supplyAlerts > 0) {
    return <FindingsAttentionBanner summary={summary} />;
  }
  if (summary.repositoriesWithoutRuns > 0) {
    return <SetupInProgressBanner summary={summary} />;
  }
  return null;
}

function RepositoryRow({ repository }: Readonly<{ repository: RepositoryGroup["repositories"][number] }>) {
  return (
    <tr className="border-t border-border">
      <th scope="row" className="px-3 py-2.5 text-left font-medium">
        <Link href={`/repositories/${repository.id}`} className="text-primary hover:underline">
          {repository.owner}/{repository.name}
        </Link>
        {repository.private ? (
          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">private</span>
        ) : undefined}
      </th>
      <td className="px-3 py-2.5">
        {repository.latestRunId ? (
          <div className="flex items-center gap-2">
            <StatusBadge value={repository.latestRunDecision ?? repository.latestRunStatus} />
            <span className="text-xs text-muted-foreground">{when(repository.latestRunAt)}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            no runs yet ·{" "}
            <Link href="/setup" className="text-primary hover:underline">
              setup
            </Link>
          </span>
        )}
      </td>
      <td className="px-3 py-2.5">{repository.latestRunId ? repository.openFindings : "—"}</td>
      <td className="px-3 py-2.5">{repository.watchedBoards}</td>
      <td className="px-3 py-2.5">{repository.openSupplyFindings}</td>
    </tr>
  );
}

function RepositorySections({ groups }: Readonly<{ groups: RepositoryGroup[] }>) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <Panel key={group.accountLogin} title={group.accountLogin} tone="section">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-3 py-2">
                    Repository
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Latest run
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Findings
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Boards watched
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Supply alerts
                  </th>
                </tr>
              </thead>
              <tbody>
                {group.repositories.map((repository) => (
                  <RepositoryRow key={repository.id} repository={repository} />
                ))}
              </tbody>
            </table>
          </div>
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
      <AttentionBanner summary={summary} />
      <RepositorySections groups={groups} />
    </div>
  );
}

export default async function DashboardPage() {
  const viewer = await viewerAuthorization();
  const groups = await loadViewerRepositories(viewer.session);
  const summary = summarizeViewerRepositories(groups);

  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main id="main-content" className="flex flex-col gap-5 px-6 py-6">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Dashboard" }]} />
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
