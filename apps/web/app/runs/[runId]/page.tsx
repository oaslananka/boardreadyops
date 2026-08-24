import { notFound } from "next/navigation";
import { RunPageFrame, RunUnavailable, SummaryView } from "../../../components/run-investigation.js";
import { loadRunDashboard, runDashboardLoaderDependencies } from "../../../lib/run-dashboard.js";
import { shouldLiveRefreshRun } from "../../../lib/run-live-refresh.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";

export const dynamic = "force-dynamic";

type RunPageProps = { params: Promise<{ runId: string }> };

export default async function RunPage({ params }: RunPageProps) {
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
    <RunPageFrame run={result.run} active="summary" liveRefresh={shouldLiveRefreshRun(result.run.investigationState)}>
      <SummaryView run={result.run} />
    </RunPageFrame>
  );
}
