import { computeWdrrWeekly } from "@boardreadyops/cloud-core";
import { AppShell, Breadcrumbs } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";

export const metadata = {
  title: "Insights · BoardReadyOps",
  description: "Weekly Decision-Ready Reviews (WDRR) and content-free product analytics.",
};

export default function InsightsPage() {
  const demo = computeWdrrWeekly([]);
  return (
    <AppShell viewerNav={<ViewerNav />}>
      <main className="page-frame operational-page" id="main-content">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Insights" }]} />
        <header className="page-intro">
          <h1>Insights</h1>
          <p>Weekly Decision-Ready Reviews (WDRR) and content-free product analytics.</p>
        </header>

        <div className="panel surface-raised">
          <p>
            WDRR requires: base/head revision, required checks complete, blockers dispositioned, required approval,
            evidence record.
          </p>
          <p>
            Weekly buckets:{" "}
            {demo.length === 0
              ? "No data yet — run your first cloud review"
              : demo.map((b) => `${b.weekStart}: ${b.count}`).join(", ")}
          </p>
          <p className="cell-note">
            Telemetry is content-free: no KiCad content, finding messages, comment bodies, source paths, secrets or
            emails.
          </p>
        </div>
      </main>
    </AppShell>
  );
}
