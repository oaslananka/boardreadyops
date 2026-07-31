import { notFound } from "next/navigation";
import {
  FindingsView,
  filtersFromSearchParameters,
  RunPageFrame,
  RunUnavailable,
  type SearchParameterMap,
} from "../../../../components/run-investigation.js";
import { loadRunDashboard } from "../../../../lib/run-dashboard.js";
import { shouldLiveRefreshRun } from "../../../../lib/run-live-refresh.js";

export const dynamic = "force-dynamic";

type PageProps = Readonly<{
  params: Promise<{ runId: string }>;
  searchParams: Promise<SearchParameterMap>;
}>;

export default async function FindingsPage({ params, searchParams }: PageProps) {
  const [{ runId }, query] = await Promise.all([params, searchParams]);
  const result = await loadRunDashboard(runId, process.env, filtersFromSearchParameters(query));
  if (result.state === "not-found") notFound();
  if (result.state === "not-configured") return <RunUnavailable runId={runId} />;
  return (
    <RunPageFrame run={result.run} active="findings" liveRefresh={shouldLiveRefreshRun(result.run.investigationState)}>
      <FindingsView run={result.run} searchParameters={query} />
    </RunPageFrame>
  );
}
