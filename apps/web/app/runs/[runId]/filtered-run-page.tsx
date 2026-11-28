import { notFound } from "next/navigation";
import {
  ArtifactsView,
  FindingsView,
  filtersFromSearchParameters,
  RunPageFrame,
  RunUnavailable,
  type SearchParameterMap,
} from "../../../components/run-investigation.js";
import { loadRunDashboard, resolveRunPageTitle, runDashboardLoaderDependencies } from "../../../lib/run-dashboard.js";
import { shouldLiveRefreshRun } from "../../../lib/run-live-refresh.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";

export type FilteredRunPageProps = Readonly<{
  params: Promise<{ runId: string }>;
  searchParams: Promise<SearchParameterMap>;
}>;

export async function resolveFilteredRunMetadata(
  params: FilteredRunPageProps["params"],
  section: "Artifacts" | "Findings",
) {
  const { runId } = await params;
  const viewer = await viewerAuthorization();
  return { title: await resolveRunPageTitle(runId, section, viewer.authorizeRepository) };
}

/** Both filtered evidence routes use the same request-scoped authorization and session. */
export async function renderFilteredRunPage({
  params,
  searchParams,
  active,
}: FilteredRunPageProps & { readonly active: "findings" | "artifacts" }) {
  const [{ runId }, query] = await Promise.all([params, searchParams]);
  const viewer = await viewerAuthorization();
  const result = await loadRunDashboard(runId, process.env, filtersFromSearchParameters(query), {
    ...runDashboardLoaderDependencies,
    authorizeRepository: viewer.authorizeRepository,
  });
  if (result.state === "not-found") notFound();
  if (result.state === "not-configured") return <RunUnavailable runId={runId} />;
  const signedIn = Boolean(viewer.session);
  return (
    <RunPageFrame
      signedIn={signedIn}
      run={result.run}
      active={active}
      liveRefresh={shouldLiveRefreshRun(result.run.investigationState)}
    >
      {active === "findings" ? (
        <FindingsView signedIn={signedIn} run={result.run} searchParameters={query} />
      ) : (
        <ArtifactsView run={result.run} searchParameters={query} />
      )}
    </RunPageFrame>
  );
}
