import { notFound } from "next/navigation";
import { RunDesignView } from "../../../../components/run-design-view.js";
import { RunPageFrame, RunUnavailable } from "../../../../components/run-investigation.js";
import {
  loadRunDashboard,
  resolveRunPageTitle,
  runDashboardLoaderDependencies,
} from "../../../../lib/run-dashboard.js";
import { loadRunDesignSnapshots } from "../../../../lib/run-design-snapshots.js";
import { shouldLiveRefreshRun } from "../../../../lib/run-live-refresh.js";
import { viewerAuthorization } from "../../../../lib/viewer-authorization.js";

export const dynamic = "force-dynamic";

type RunDesignPageProps = { params: Promise<{ runId: string }> };

export async function generateMetadata({ params }: RunDesignPageProps) {
  const { runId } = await params;
  const viewer = await viewerAuthorization();
  return { title: await resolveRunPageTitle(runId, "Design", viewer.authorizeRepository) };
}

export default async function RunDesignPage({ params }: Readonly<RunDesignPageProps>) {
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
  const snapshots = await loadRunDesignSnapshots(runId, result.run.repositoryId);
  return (
    <RunPageFrame run={result.run} active="design" liveRefresh={shouldLiveRefreshRun(result.run.investigationState)}>
      <RunDesignView
        runId={runId}
        snapshots={snapshots}
        findings={result.run.findings}
        totalFindings={result.run.findingsPage.total}
        repository={result.run.repository}
        commitSha={result.run.commitSha}
        {...(result.run.reviewId ? { reviewId: result.run.reviewId } : {})}
      />
    </RunPageFrame>
  );
}
