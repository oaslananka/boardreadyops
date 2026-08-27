import { computeWdrrWeekly } from "@boardreadyops/cloud-core";

export default function InsightsPage() {
  const demo = computeWdrrWeekly([]);
  return (
    <div className="panel">
      <header className="panel-header">
        <div>
          <h1>Insights</h1>
          <p>Weekly Decision-Ready Reviews (WDRR) and content-free product analytics.</p>
        </div>
      </header>
      <p>
        WDRR requires: base/head revision, required checks complete, blockers dispositioned, required approval, evidence
        record.
      </p>
      <p>
        Weekly buckets:{" "}
        {demo.length === 0
          ? "No data yet — run your first cloud review"
          : demo.map((b) => `${b.weekStart}: ${b.count}`).join(", ")}
      </p>
      <p className="cell-note">
        Telemetry is content-free: no KiCad content, finding messages, comment bodies, source paths, secrets or emails.
      </p>
    </div>
  );
}
