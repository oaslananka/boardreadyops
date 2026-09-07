import { BillingStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { PlanComparisonCard } from "../../../components/billing/plan-comparison-card.js";
import { Alert } from "../../../components/ui.js";
import { resolveBillingMode } from "../../../lib/billing-mode.js";
import { resolveCloudPersistenceConfiguration } from "../../../lib/cloud-runtime-config.js";
import { summarizeSubscription } from "../../../lib/subscription-summary.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";
import { viewerInstallations } from "../../../lib/viewer-installations.js";

export const runtime = "nodejs";

export const metadata = {
  title: "Billing & Plans",
};

export default async function BillingSettingsPage() {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return (
      <div className="rounded-md border border-border bg-card p-5 shadow-e2">
        <h2 className="text-lg font-bold text-foreground">Billing & Subscriptions</h2>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to view and manage your BoardReadyOps plan.</p>
      </div>
    );
  }

  const config = resolveCloudPersistenceConfiguration();
  const billingMode = resolveBillingMode();
  let current = 0;
  let forecast = 0;
  let hasStripeCustomer = false;

  // The tier comes from the viewer's installations, which billing-store keeps in step with both
  // Stripe subscriptions and Marketplace purchases. This page used to hardcode "community", so a
  // paying customer was told they were on the free plan.
  const subscription = summarizeSubscription(await viewerInstallations(viewer.session, "nexar"));

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
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border bg-card p-5 shadow-e2">
        <header>
          <h2 id="billing-heading" className="text-lg font-bold text-foreground">
            Workspace Subscription & Plans
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose the tier that matches your hardware design workflow, team scale, and manufacturing delivery
            requirements. Community edition is included by default for individual makers and open-source hardware.
          </p>
        </header>

        {subscription.accountLogin ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Your entitlement comes from <strong className="text-foreground">{subscription.accountLogin}</strong>
            {subscription.mixed ? " — the highest tier across your installations." : "."}
          </p>
        ) : null}

        {billingMode === "marketplace_free" ? (
          <div className="mt-4">
            <Alert title="Plan changes go through GitHub Marketplace" tone="info">
              <p>
                This deployment does not run self-serve Stripe checkout, so upgrades and payment details are managed on
                your GitHub Marketplace subscription.
              </p>
            </Alert>
          </div>
        ) : null}

        <div className="mt-4">
          <PlanComparisonCard
            currentTier={subscription.tier}
            hasStripeCustomer={hasStripeCustomer}
            billingMode={billingMode}
          />
        </div>
      </div>

      <div className="rounded-md border border-border bg-card p-5 shadow-e2">
        <header>
          <h3 className="text-base font-bold text-foreground">Active Seat & Contributor Metrics</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Measured monthly across active engineering collaborators in this workspace.
          </p>
        </header>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Active contributors (current)
            </dt>
            <dd className="mt-1 text-sm text-foreground">{current}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Forecast (month end)
            </dt>
            <dd className="mt-1 text-sm text-foreground">{forecast}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
