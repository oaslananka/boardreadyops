import Link from "next/link";
import { AppShell, Breadcrumbs, EmptyState, Panel, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { loadViewerRepositories } from "../../lib/repository-dashboard.js";
import { viewerAuthorization } from "../../lib/viewer-authorization.js";

export const metadata = {
  title: "Dashboard · BoardReadyOps",
  description: "Repositories BoardReadyOps is watching, their latest release readiness, and open findings.",
};

function when(value: string | undefined): string {
  if (!value) return "never";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "unknown" : new Date(parsed).toISOString().replace("T", " ").slice(0, 16);
}

export default async function DashboardPage() {
  const viewer = await viewerAuthorization();
  const groups = await loadViewerRepositories(viewer.session);
  const total = groups.reduce((sum, group) => sum + group.repositories.length, 0);

  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="page-frame operational-page" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Dashboard" }]} />
        <header className="page-intro">
          <h1>Dashboard</h1>
          <p>Repositories BoardReadyOps is watching, with the latest release readiness for each.</p>
        </header>

        {!viewer.session ? (
          <Panel title="Sign in required">
            <EmptyState title="Sign in to see your repositories">
              <p>
                BoardReadyOps shows the repositories your GitHub App installations can access, so it needs to know who
                you are.
              </p>
            </EmptyState>
          </Panel>
        ) : total === 0 ? (
          <Panel title="No repositories">
            <EmptyState title="Nothing is being watched yet">
              <p>
                Install the BoardReadyOps GitHub App on a repository with a KiCad project, then open a pull request. The
                first run appears here.
              </p>
            </EmptyState>
          </Panel>
        ) : (
          groups.map((group) => (
            <Panel key={group.accountLogin} title={group.accountLogin}>
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
                      <tr key={repository.id}>
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
                            <span className="repository-when">no runs yet</span>
                          )}
                        </td>
                        <td>{repository.latestRunId ? repository.openFindings : "—"}</td>
                        <td>{repository.watchedBoards}</td>
                        <td>{repository.openSupplyFindings}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ))
        )}
      </main>
    </AppShell>
  );
}
