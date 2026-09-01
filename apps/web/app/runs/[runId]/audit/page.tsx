import { notFound } from "next/navigation";
import { AuditView, RunPageFrame, RunUnavailable } from "../../../../components/run-investigation.js";
import {
  loadRunDashboard,
  resolveRunPageTitle,
  runDashboardLoaderDependencies,
} from "../../../../lib/run-dashboard.js";
import { shouldLiveRefreshRun } from "../../../../lib/run-live-refresh.js";
import { viewerAuthorization } from "../../../../lib/viewer-authorization.js";

export const dynamic = "force-dynamic";

type PageProps = Readonly<{ params: Promise<{ runId: string }> }>;

export async function generateMetadata({ params }: PageProps) {
  const { runId } = await params;
  const viewer = await viewerAuthorization();
  return { title: await resolveRunPageTitle(runId, "Audit", viewer.authorizeRepository) };
}

export default async function AuditPage({ params }: PageProps) {
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
    <RunPageFrame run={result.run} active="audit" liveRefresh={shouldLiveRefreshRun(result.run.investigationState)}>
      <AuditView run={result.run} />
    </RunPageFrame>
  );
}
