import { notFound } from "next/navigation";
import { AttemptsView, RunPageFrame, RunUnavailable } from "../../../../components/run-investigation.js";
import { formatRunPageTitle, loadRunDashboard, runDashboardLoaderDependencies } from "../../../../lib/run-dashboard.js";
import { shouldLiveRefreshRun } from "../../../../lib/run-live-refresh.js";
import { viewerAuthorization } from "../../../../lib/viewer-authorization.js";

export const dynamic = "force-dynamic";

type PageProps = Readonly<{ params: Promise<{ runId: string }> }>;

export async function generateMetadata({ params }: PageProps) {
  const { runId } = await params;
  const viewer = await viewerAuthorization();
  const result = await loadRunDashboard(
    runId,
    process.env,
    {},
    {
      ...runDashboardLoaderDependencies,
      authorizeRepository: viewer.authorizeRepository,
    },
  );
  return { title: result.state === "found" ? formatRunPageTitle(result.run, "Attempts") : "Run" };
}

export default async function AttemptsPage({ params }: PageProps) {
  const { runId } = await params;
  const viewer = await viewerAuthorization();
  const result = await loadRunDashboard(
    runId,
    process.env,
    {},
    {
      ...runDashboardLoaderDependencies,
      authorizeRepository: viewer.authorizeRepository,
    },
  );
  if (result.state === "not-found") notFound();
  if (result.state === "not-configured") return <RunUnavailable runId={runId} />;
  return (
    <RunPageFrame run={result.run} active="attempts" liveRefresh={shouldLiveRefreshRun(result.run.investigationState)}>
      <AttemptsView run={result.run} />
    </RunPageFrame>
  );
}
