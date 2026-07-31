import { notFound } from "next/navigation";
import { PublicationView, RunPageFrame, RunUnavailable } from "../../../../components/run-investigation.js";
import { loadRunDashboard } from "../../../../lib/run-dashboard.js";
import { shouldLiveRefreshRun } from "../../../../lib/run-live-refresh.js";

export const dynamic = "force-dynamic";

type PageProps = Readonly<{ params: Promise<{ runId: string }> }>;

export default async function PublicationPage({ params }: PageProps) {
  const { runId } = await params;
  const result = await loadRunDashboard(runId);
  if (result.state === "not-found") notFound();
  if (result.state === "not-configured") return <RunUnavailable runId={runId} />;
  return (
    <RunPageFrame
      run={result.run}
      active="publication"
      liveRefresh={shouldLiveRefreshRun(result.run.investigationState)}
    >
      <PublicationView run={result.run} />
    </RunPageFrame>
  );
}
