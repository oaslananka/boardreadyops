import Link from "next/link";
import { notFound } from "next/navigation";
import { GuidedChecklist } from "../../../components/guided-checklist.js";
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
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <Breadcrumbs
          items={[
            { href: "/", label: "Home" },
            { href: "/dashboard", label: "Dashboard" },
            { label: `${repository.owner}/${repository.name}` },
          ]}
        />
        <header>
          <h1 className="text-2xl font-bold text-foreground">
            {repository.owner}/{repository.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Release readiness history and open supply findings for this repository.
          </p>
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
            <GuidedChecklist
              heading="Trigger your first run on this repository"
              steps={[
                {
                  id: "connected",
                  label: `Repository ${repository.owner}/${repository.name} connected`,
                  status: "done",
                },
                {
                  id: "pr",
                  label: "Open a pull request touching the hardware project to produce the first run",
                  status: "current",
                },
              ]}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                    <th scope="col" className="py-2 pr-3">
                      Run
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Outcome
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Ref
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Findings
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Started
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b border-border last:border-b-0">
                      <th scope="row" className="py-2 pr-3 text-left font-normal">
                        <Link href={`/runs/${run.id}`} className="text-primary hover:underline">
                          {run.commitSha.slice(0, 8) || run.id.slice(0, 8)}
                        </Link>
                      </th>
                      <td className="py-2 pr-3">
                        <StatusBadge value={run.decision ?? run.status} />
                      </td>
                      <td className="py-2 pr-3">
                        {run.pullRequestNumber !== undefined
                          ? `#${run.pullRequestNumber}`
                          : run.ref.replace(/^refs\/heads\//u, "")}
                      </td>
                      <td className="py-2 pr-3">{run.findingCount}</td>
                      <td className="py-2 pr-3">
                        <span className="text-muted-foreground">{when(run.startedAt)}</span>
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
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                    <th scope="col" className="py-2 pr-3">
                      Part
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Board
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Status
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Reference
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Detected
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {supplyFindings.map((finding) => (
                    <tr
                      key={`${finding.boardPath}:${finding.mpn}:${finding.reference ?? ""}`}
                      className="border-b border-border last:border-b-0"
                    >
                      <th scope="row" className="py-2 pr-3 text-left font-normal">
                        {finding.mpn}
                        {finding.manufacturer ? (
                          <span className="ml-2 text-muted-foreground">{finding.manufacturer}</span>
                        ) : undefined}
                      </th>
                      <td className="py-2 pr-3">{finding.boardPath}</td>
                      <td className="py-2 pr-3">
                        <StatusBadge value={finding.status} />
                      </td>
                      <td className="py-2 pr-3">{finding.reference ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <span className="text-muted-foreground">{when(finding.detectedAt)}</span>
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
