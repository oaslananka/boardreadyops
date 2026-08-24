import { notFound } from "next/navigation";
import {
  FindingsView,
  filtersFromSearchParameters,
  RunPageFrame,
  RunUnavailable,
  type SearchParameterMap,
} from "../../../../components/run-investigation.js";
import { loadRunDashboard, runDashboardLoaderDependencies } from "../../../../lib/run-dashboard.js";
import { shouldLiveRefreshRun } from "../../../../lib/run-live-refresh.js";
import { viewerAuthorization } from "../../../../lib/viewer-authorization.js";

export const dynamic = "force-dynamic";

type PageProps = Readonly<{
  params: Promise<{ runId: string }>;
  searchParams: Promise<SearchParameterMap>;
}>;

export default async function FindingsPage({ params, searchParams }: PageProps) {
  const [{ runId }, query] = await Promise.all([params, searchParams]);
  const viewer = await viewerAuthorization();
  const result = await loadRunDashboard(runId, process.env, filtersFromSearchParameters(query), {
    ...runDashboardLoaderDependencies,
    authorizeRepository: viewer.authorizeRepository,
  });
  if (result.state === "not-found") notFound();
  if (result.state === "not-configured") return <RunUnavailable runId={runId} />;
  return (
    <RunPageFrame run={result.run} active="findings" liveRefresh={shouldLiveRefreshRun(result.run.investigationState)}>
      <FindingsView run={result.run} searchParameters={query} />
    </RunPageFrame>
  );
}
