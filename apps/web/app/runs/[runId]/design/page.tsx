import { notFound } from "next/navigation";
import { RunDesignView } from "../../../../components/run-design-view.js";
import {
  filtersFromSearchParameters,
  RunPageFrame,
  RunUnavailable,
  type SearchParameterMap,
} from "../../../../components/run-investigation.js";
import {
  loadRunDashboard,
  resolveRunPageTitle,
  runDashboardLoaderDependencies,
} from "../../../../lib/run-dashboard.js";
import { loadRunDesignBaseSnapshots, loadRunDesignSnapshots } from "../../../../lib/run-design-snapshots.js";
import { shouldLiveRefreshRun } from "../../../../lib/run-live-refresh.js";
import { viewerAuthorization } from "../../../../lib/viewer-authorization.js";

export const dynamic = "force-dynamic";

type RunDesignPageProps = {
  params: Promise<{ runId: string }>;
  searchParams: Promise<SearchParameterMap>;
};

export async function generateMetadata({ params }: RunDesignPageProps) {
  const { runId } = await params;
  const viewer = await viewerAuthorization();
  return { title: await resolveRunPageTitle(runId, "Design", viewer.authorizeRepository) };
}

export default async function RunDesignPage({ params, searchParams }: Readonly<RunDesignPageProps>) {
  const [{ runId }, query] = await Promise.all([params, searchParams]);
  const viewer = await viewerAuthorization();
  const result = await loadRunDashboard(
    runId,
    process.env,
    { findingsPage: filtersFromSearchParameters(query).findingsPage ?? 1 },
    {
      ...runDashboardLoaderDependencies,
      authorizeRepository: viewer.authorizeRepository,
    },
  );
  if (result.state === "not-found") notFound();
  if (result.state === "not-configured") return <RunUnavailable runId={runId} />;
  const [snapshots, baseSnapshots] = await Promise.all([
    loadRunDesignSnapshots(runId, result.run.repositoryId),
    loadRunDesignBaseSnapshots(runId, result.run.repositoryId),
  ]);
  return (
    <RunPageFrame run={result.run} active="design" liveRefresh={shouldLiveRefreshRun(result.run.investigationState)}>
      <RunDesignView
        runId={runId}
        snapshots={snapshots}
        baseSnapshots={baseSnapshots}
        findings={result.run.findings}
        findingsPage={result.run.findingsPage}
        totalFindings={result.run.findingsPage.total}
        repository={result.run.repository}
        commitSha={result.run.commitSha}
        {...(result.run.reviewId ? { reviewId: result.run.reviewId } : {})}
      />
    </RunPageFrame>
  );
}
