import { BillingStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { resolveCloudPersistenceConfiguration } from "../../../lib/cloud-runtime-config.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";

export const runtime = "nodejs";

export const metadata = {
  title: "Billing & Seats",
};

export default async function BillingSettingsPage() {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return (
      <div className="panel">
        <h2>Marketplace plan</h2>
        <p>Sign in to view your BoardReadyOps plan.</p>
      </div>
    );
  }

  const config = resolveCloudPersistenceConfiguration();
  let current = 0;
  let forecast = 0;
  if (config.mode === "postgres") {
    const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
    try {
      const store = new BillingStore(executor);
      const forecastData = await store.forecastContributors(viewer.session.login);
      current = forecastData.current;
      forecast = forecastData.forecast;
    } finally {
      await executor.close();
    }
  }

  return (
    <div className="panel">
      <header className="panel-header">
        <div>
          <h2 id="billing-heading">Marketplace Plan</h2>
          <p>
            BoardReadyOps is currently offered on GitHub Marketplace through the Community plan. The Marketplace plan is
            free and does not require an external payment method.
          </p>
        </div>
      </header>
      <dl className="definition-grid">
        <div>
          <dt>Published Marketplace plan</dt>
          <dd>Community · Free</dd>
        </div>
        <div>
          <dt>Marketplace billing</dt>
          <dd>Managed by GitHub Marketplace</dd>
        </div>
        <div>
          <dt>Active contributors (current)</dt>
          <dd>{current}</dd>
        </div>
        <div>
          <dt>Forecast (month end)</dt>
          <dd>{forecast}</dd>
        </div>
      </dl>
      <p className="cell-note">
        Plan activation and cancellation are synchronized from GitHub Marketplace. BoardReadyOps does not request
        payment details for the Community plan.
      </p>
    </div>
  );
}
