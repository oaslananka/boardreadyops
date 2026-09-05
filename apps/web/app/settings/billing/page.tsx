import { BillingStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { PlanComparisonCard } from "../../../components/billing/plan-comparison-card.js";
import { resolveCloudPersistenceConfiguration } from "../../../lib/cloud-runtime-config.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";

export const runtime = "nodejs";

export const metadata = {
  title: "Billing & Plans",
};

export default async function BillingSettingsPage() {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return (
      <div className="panel">
        <h2>Billing & Subscriptions</h2>
        <p>Sign in to view and manage your BoardReadyOps plan.</p>
      </div>
    );
  }

  const config = resolveCloudPersistenceConfiguration();
  let current = 0;
  let forecast = 0;
  let hasStripeCustomer = false;
  const currentTier: "community" | "team" | "business" | "pilot" = "community";

  if (config.mode === "postgres") {
    const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
    try {
      const store = new BillingStore(executor);
      const forecastData = await store.forecastContributors(viewer.session.login);
      current = forecastData.current;
      forecast = forecastData.forecast;
      const customer = await store.getCustomer(viewer.session.login);
      if (customer?.stripeCustomerId) {
        hasStripeCustomer = true;
      }
    } finally {
      await executor.close();
    }
  }

  return (
    <div className="billing-settings-page">
      <div className="panel">
        <header className="panel-header">
          <div>
            <h2 id="billing-heading">Workspace Subscription & Plans</h2>
            <p>
              Choose the tier that matches your hardware design workflow, team scale, and manufacturing delivery
              requirements. Community edition is included by default for individual makers and open-source hardware.
            </p>
          </div>
        </header>

        <PlanComparisonCard currentTier={currentTier} hasStripeCustomer={hasStripeCustomer} />
      </div>

      <div className="panel" style={{ marginTop: "var(--space-4)" }}>
        <header className="panel-header">
          <div>
            <h3>Active Seat & Contributor Metrics</h3>
            <p>Measured monthly across active engineering collaborators in this workspace.</p>
          </div>
        </header>
        <dl className="definition-grid">
          <div>
            <dt>Active contributors (current)</dt>
            <dd>{current}</dd>
          </div>
          <div>
            <dt>Forecast (month end)</dt>
            <dd>{forecast}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
