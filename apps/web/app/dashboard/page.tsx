import Link from "next/link";
import { AppShell, Breadcrumbs, EmptyState, Panel, StatusBadge } from "../../components/ui.js";
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
      <EmptyState title="Sign in to see your repositories">
        <p>
          BoardReadyOps shows the repositories your GitHub App installations can access, so it needs to know who you
          are.
        </p>
      </EmptyState>
    </Panel>
  );
}

function NoRepositoriesPanel() {
  return (
    <Panel title="No repositories">
      <EmptyState title="Nothing is being watched yet">
        <p>
          Install the BoardReadyOps GitHub App on a repository with a KiCad project, then open a pull request. The first
          run appears here.
        </p>
        <div>
          <Link className="button button-primary" href="/setup">
            Open repository setup preview
          </Link>
        </div>
      </EmptyState>
    </Panel>
  );
}

function OperationalSummarySection({ summary }: Readonly<{ summary: DashboardRepositorySummary }>) {
  return (
    <section className="operational-summary" aria-labelledby="operational-summary-heading">
      <header>
        <p className="context-kicker">Current scope</p>
        <h2 id="operational-summary-heading">Engineering status</h2>
      </header>
      <dl className="operational-summary-grid">
        <div>
          <dt>Repositories</dt>
          <dd>{summary.repositories}</dd>
        </div>
        <div>
          <dt>Repositories with findings</dt>
          <dd>{summary.repositoriesWithOpenFindings}</dd>
        </div>
        <div>
          <dt>Supply alerts</dt>
          <dd>{summary.supplyAlerts}</dd>
        </div>
        <div>
          <dt>No run yet</dt>
          <dd>{summary.repositoriesWithoutRuns}</dd>
        </div>
        <div>
          <dt>Boards watched</dt>
          <dd>{summary.watchedBoards}</dd>
        </div>
      </dl>
    </section>
  );
}

function FindingsAttentionBanner({ summary }: Readonly<{ summary: DashboardRepositorySummary }>) {
  return (
    <output className="dashboard-attention">
      <div>
        <p className="context-kicker">Attention required</p>
        <strong>
          {summary.repositoriesWithOpenFindings}{" "}
          {summary.repositoriesWithOpenFindings === 1 ? "repository has" : "repositories have"} open findings
          {summary.supplyAlerts > 0 ? ` and ${summary.supplyAlerts} supply alerts` : ""} before fabrication.
        </strong>
      </div>
      <div className="dashboard-attention-action">
        <span className="dashboard-attention-tag">Next action</span>
        <span>Inspect findings below and resolve blocking design violations.</span>
      </div>
    </output>
  );
}

function SetupInProgressBanner({ summary }: Readonly<{ summary: DashboardRepositorySummary }>) {
  return (
    <output className="dashboard-attention">
      <div>
        <p className="context-kicker">Setup in progress</p>
        <strong>
          {summary.repositoriesWithoutRuns}{" "}
          {summary.repositoriesWithoutRuns === 1 ? "repository is" : "repositories are"} waiting for an initial release
          check.
        </strong>
      </div>
      <div className="dashboard-attention-action">
        <span className="dashboard-attention-tag">Next action</span>
        <Link href="/setup">Review setup workflow and dispatch probe →</Link>
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
    <tr>
      <th scope="row">
        <Link href={`/repositories/${repository.id}`}>
          {repository.owner}/{repository.name}
        </Link>
        {repository.private ? <span className="repository-private">private</span> : undefined}
      </th>
      <td>
        {repository.latestRunId ? (
          <>
            <StatusBadge value={repository.latestRunDecision ?? repository.latestRunStatus} />
            <span className="repository-when">{when(repository.latestRunAt)}</span>
          </>
        ) : (
          <span className="repository-when">
            no runs yet · <Link href="/setup">setup</Link>
          </span>
        )}
      </td>
      <td>{repository.latestRunId ? repository.openFindings : "—"}</td>
      <td>{repository.watchedBoards}</td>
      <td>{repository.openSupplyFindings}</td>
    </tr>
  );
}

function RepositorySections({ groups }: Readonly<{ groups: RepositoryGroup[] }>) {
  return (
    <div className="repository-sections">
      {groups.map((group) => (
        <Panel key={group.accountLogin} title={group.accountLogin} tone="section">
          <div className="repository-table-wrap">
            <table className="repository-table">
              <thead>
                <tr>
                  <th scope="col">Repository</th>
                  <th scope="col">Latest run</th>
                  <th scope="col">Findings</th>
                  <th scope="col">Boards watched</th>
                  <th scope="col">Supply alerts</th>
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
    <>
      <OperationalSummarySection summary={summary} />
      <AttentionBanner summary={summary} />
      <RepositorySections groups={groups} />
    </>
  );
}

export default async function DashboardPage() {
  const viewer = await viewerAuthorization();
  const groups = await loadViewerRepositories(viewer.session);
  const summary = summarizeViewerRepositories(groups);

  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="page-frame operational-page" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Dashboard" }]} />
        <header className="page-intro">
          <h1>Dashboard</h1>
          <p>Repositories BoardReadyOps is watching, with the latest release readiness for each.</p>
        </header>
        <DashboardBody hasSession={Boolean(viewer.session)} groups={groups} summary={summary} />
      </main>
    </AppShell>
  );
}
