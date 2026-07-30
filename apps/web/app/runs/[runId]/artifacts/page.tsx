import { notFound } from "next/navigation";
import {
  ArtifactsView,
  filtersFromSearchParameters,
  RunPageFrame,
  RunUnavailable,
  type SearchParameterMap,
} from "../../../../components/run-investigation.js";
import { loadRunDashboard } from "../../../../lib/run-dashboard.js";

export const dynamic = "force-dynamic";

type PageProps = Readonly<{
  params: Promise<{ runId: string }>;
  searchParams: Promise<SearchParameterMap>;
}>;

export default async function ArtifactsPage({ params, searchParams }: PageProps) {
  const [{ runId }, query] = await Promise.all([params, searchParams]);
  const result = await loadRunDashboard(runId, process.env, filtersFromSearchParameters(query));
  if (result.state === "not-found") notFound();
  if (result.state === "not-configured") return <RunUnavailable runId={runId} />;
  return (
    <RunPageFrame run={result.run} active="artifacts">
      <ArtifactsView run={result.run} searchParameters={query} />
    </RunPageFrame>
  );
}
