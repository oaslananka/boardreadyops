import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AppShell,
  Breadcrumbs,
  Definition,
  DefinitionGrid,
  EmptyState,
  Panel,
  StatusBadge,
} from "../../../components/ui.js";
import { ViewerNav } from "../../../components/viewer-nav.js";
import { loadRepositoryDetail } from "../../../lib/repository-dashboard.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";

type PageProps = {
  params: Promise<{ repositoryId: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { repositoryId } = await params;
  const viewer = await viewerAuthorization();
  const detail = await loadRepositoryDetail(repositoryId, viewer.session);
  return {
    title: detail ? `${detail.repository.owner}/${detail.repository.name}` : "Repository",
    description: "Recent release readiness runs and open supply findings for one repository.",
  };
}

function when(value: string | undefined): string {
  if (!value) return "unknown";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "unknown" : new Date(parsed).toISOString().replace("T", " ").slice(0, 16);
}

export default async function RepositoryPage({ params }: PageProps) {
  const { repositoryId } = await params;
  const viewer = await viewerAuthorization();
  const detail = await loadRepositoryDetail(repositoryId, viewer.session);

  // A repository the viewer cannot administer answers the same as one that does not exist, so
  // this page cannot be used to discover which repositories are enrolled.
  //
  // Returned rather than called bare: notFound() never returns, but saying so explicitly keeps
  // the narrowing obvious to a reader, and to any analyser that does not model Next's helpers.
  if (!detail) return notFound();

  const { repository, runs, supplyFindings } = detail;

  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="shell" id="main-content">
        <Breadcrumbs
          items={[
            { href: "/", label: "Home" },
            { href: "/dashboard", label: "Dashboard" },
            { label: `${repository.owner}/${repository.name}` },
          ]}
        />
        <header className="page-heading">
          <h1>
            {repository.owner}/{repository.name}
          </h1>
          <p>Release readiness history and open supply findings for this repository.</p>
        </header>

        <Panel title="Current state">
          <DefinitionGrid>
            <Definition label="Visibility">{repository.private ? "Private" : "Public"}</Definition>
            <Definition label="Latest run">
              {repository.latestRunId ? (
                <StatusBadge value={repository.latestRunDecision ?? repository.latestRunStatus} />
              ) : (
                "No runs yet"
              )}
            </Definition>
            <Definition label="Open findings">{repository.latestRunId ? repository.openFindings : "—"}</Definition>
            <Definition label="Boards watched">{repository.watchedBoards}</Definition>
          </DefinitionGrid>
        </Panel>

        <Panel title="Recent runs">
          {runs.length === 0 ? (
            <EmptyState title="No runs yet">
              <p>Open a pull request touching the hardware project to produce the first run.</p>
            </EmptyState>
          ) : (
            <div className="repository-table-wrap">
              <table className="repository-table">
                <thead>
                  <tr>
                    <th scope="col">Run</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Ref</th>
                    <th scope="col">Findings</th>
                    <th scope="col">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <th scope="row">
                        <Link href={`/runs/${run.id}`}>{run.commitSha.slice(0, 8) || run.id.slice(0, 8)}</Link>
                      </th>
                      <td>
                        <StatusBadge value={run.decision ?? run.status} />
                      </td>
                      <td>
                        {run.pullRequestNumber !== undefined
                          ? `#${run.pullRequestNumber}`
                          : run.ref.replace(/^refs\/heads\//u, "")}
                      </td>
                      <td>{run.findingCount}</td>
                      <td>
                        <span className="repository-when">{when(run.startedAt)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Open supply findings">
          {supplyFindings.length === 0 ? (
            <EmptyState title="No open supply findings">
              <p>
                Parts on watched boards are either current or not yet checked. Supply watch needs a component data
                provider credential and a plan that includes it.
              </p>
            </EmptyState>
          ) : (
            <div className="repository-table-wrap">
              <table className="repository-table">
                <thead>
                  <tr>
                    <th scope="col">Part</th>
                    <th scope="col">Board</th>
                    <th scope="col">Status</th>
                    <th scope="col">Reference</th>
                    <th scope="col">Detected</th>
                  </tr>
                </thead>
                <tbody>
                  {supplyFindings.map((finding) => (
                    <tr key={`${finding.boardPath}:${finding.mpn}:${finding.reference ?? ""}`}>
                      <th scope="row">
                        {finding.mpn}
                        {finding.manufacturer ? (
                          <span className="repository-when">{finding.manufacturer}</span>
                        ) : undefined}
                      </th>
                      <td>{finding.boardPath}</td>
                      <td>
                        <StatusBadge value={finding.status} />
                      </td>
                      <td>{finding.reference ?? "—"}</td>
                      <td>
                        <span className="repository-when">{when(finding.detectedAt)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </main>
    </AppShell>
  );
}
