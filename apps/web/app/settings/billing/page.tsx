import { BillingStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { resolveCloudPersistenceConfiguration } from "../../../lib/cloud-runtime-config.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";

export const runtime = "nodejs";

export default async function BillingSettingsPage() {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return (
      <div className="panel">
        <h1>Billing</h1>
        <p>Sign in to manage your subscription.</p>
      </div>
    );
  }
  const config = resolveCloudPersistenceConfiguration();
  let current = 0;
  let forecast = 0;
  let tier = "free";
  let status = "active";
  if (config.mode === "postgres") {
    const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
    try {
      const store = new BillingStore(executor);
      const tenantId = viewer.session.login;
      const cust = await store.getCustomer(tenantId);
      if (cust) {
        tier = cust.tier;
        status = cust.status;
      }
      const forecastData = await store.forecastContributors(tenantId);
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
          <h1 id="billing-heading">Billing & Seats</h1>
          <p>
            Active contributors are internal users who performed a policy, disposition, release or workspace action this
            month. Guests and read-only users are free.
          </p>
        </div>
      </header>
      <dl className="definition-grid">
        <div>
          <dt>Current plan</dt>
          <dd>
            {tier} · {status}
          </dd>
        </div>
        <div>
          <dt>Active contributors (current)</dt>
          <dd>{current}</dd>
        </div>
        <div>
          <dt>Forecast (month end)</dt>
          <dd>{forecast}</dd>
        </div>
        <div>
          <dt>Team</dt>
          <dd>$24 / contributor / month ($20 billed yearly)</dd>
        </div>
        <div>
          <dt>Business</dt>
          <dd>$55 / contributor / month ($45 billed yearly)</dd>
        </div>
      </dl>
      <div className="panel-actions" style={{ marginTop: "1rem" }}>
        <form action="/api/v1/billing/checkout" method="post">
          <button type="submit" className="button button-primary">
            Manage via Stripe Checkout
          </button>
        </form>
        <form action="/api/v1/billing/portal" method="post">
          <button type="submit" className="button button-secondary">
            Open Customer Portal
          </button>
        </form>
      </div>
      <p className="cell-note">
        Stripe Price IDs and secrets are configured via environment variables. See docs/billing.md for manual
        provisioning steps.
      </p>
    </div>
  );
}
