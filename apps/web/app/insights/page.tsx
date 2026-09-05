import { AppShell, Breadcrumbs, EmptyState, Panel } from "../../components/ui.js";
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

  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Insights" }]} />
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
          <div className="rounded-md border border-border bg-card p-4 shadow-lg">
            <p className="text-sm text-foreground">
              WDRR requires: base/head revision, required checks complete, blockers dispositioned, required approval,
              evidence record.
            </p>
            <p className="mt-2 text-sm text-foreground">
              Weekly buckets:{" "}
              {weekly.length === 0
                ? "No data yet — run your first cloud review"
                : weekly.map((b) => `${b.weekStart}: ${b.count}`).join(", ")}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Telemetry is content-free: no CAD design content, finding messages, comment bodies, source paths, secrets
              or emails.
            </p>
          </div>
        )}
      </main>
    </AppShell>
  );
}
