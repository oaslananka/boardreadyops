import { TrendChart } from "../../components/ui/trend-chart.js";
import { AppShell, EmptyState, Panel } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import { viewerAuthorization } from "../../lib/viewer-authorization.js";
import { loadViewerWdrrWeekly } from "../../lib/wdrr-dashboard.js";

export const metadata = {
  title: "Insights",
  description: "Weekly Decision-Ready Reviews (WDRR) and content-free product analytics.",
};

export default async function InsightsPage() {
  const viewer = await viewerAuthorization();
  const weekly = await loadViewerWdrrWeekly(viewer.session);
  const total = weekly.reduce((sum, bucket) => sum + bucket.count, 0);

  return (
    <AppShell viewerNav={<ViewerNav />} breadcrumbs={[{ href: "/", label: "Home" }, { label: "Insights" }]}>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <header>
          <h1 className="text-2xl font-bold text-foreground">Insights</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Weekly Decision-Ready Reviews (WDRR) and content-free product analytics.
          </p>
        </header>

        {!viewer.session ? (
          <Panel title="Sign in required">
            <EmptyState title="Sign in to see your insights">
              <p>
                BoardReadyOps shows Weekly Decision-Ready Review counts for the repositories your GitHub App
                installations can access, so it needs to know who you are.
              </p>
            </EmptyState>
          </Panel>
        ) : (
          <Panel
            title="Decision-ready reviews per week"
            description="A review counts once it has a base/head revision, complete required checks, dispositioned blockers, the required approval, and an evidence record."
          >
            {weekly.length === 0 ? (
              <EmptyState title="No decision-ready reviews yet">
                <p>Run your first cloud review and this fills in as reviews reach a decision.</p>
              </EmptyState>
            ) : (
              <>
                <p className="mb-3 text-sm text-foreground">
                  <strong className="text-2xl tabular-nums">{total}</strong>{" "}
                  <span className="text-muted-foreground">
                    decision-ready review{total === 1 ? "" : "s"} across {weekly.length} week
                    {weekly.length === 1 ? "" : "s"}
                  </span>
                </p>
                <TrendChart
                  points={weekly.map((bucket) => ({
                    label: bucket.weekStart.slice(5),
                    title: `Week of ${bucket.weekStart}`,
                    value: bucket.count,
                  }))}
                  caption="Decision-ready reviews per week"
                  periodLabel="Week starting"
                  valueLabel="reviews"
                />
              </>
            )}
            <p className="mt-4 text-meta text-muted-foreground">
              Telemetry is content-free: no CAD design content, finding messages, comment bodies, source paths, secrets
              or emails.
            </p>
          </Panel>
        )}
      </main>
    </AppShell>
  );
}
