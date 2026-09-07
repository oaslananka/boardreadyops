"use client";

import { useState } from "react";
import type { BillingMode } from "../../lib/billing-mode.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { useToast } from "../ui/toast.js";

export type CommercialTierKey = "community" | "team" | "business" | "pilot" | "enterprise";

export type PlanComparisonCardProps = Readonly<{
  currentTier?: CommercialTierKey;
  workspaceId?: string;
  hasStripeCustomer?: boolean;
  /**
   * Which billing surface this deployment serves. Defaults to `"stripe"` so existing callers and
   * tests are unaffected; the page passes the operator's real `BILLING_MODE`. Under
   * `marketplace_free` the checkout and portal endpoints return HTTP 410, so the card must not
   * offer a button that can only fail.
   */
  billingMode?: BillingMode;
}>;

interface PlanDefinition {
  key: CommercialTierKey;
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  features: string[];
}

const PLANS: PlanDefinition[] = [
  {
    key: "community",
    name: "Community",
    price: "$0",
    cadence: "forever free",
    tagline: "For individual makers and open hardware projects.",
    features: [
      "Local CLI pre-flight checks",
      "Public GitHub repositories",
      "Basic KiCad & Gerber DFM rules",
      "Community forum support",
    ],
  },
  {
    key: "team",
    name: "Team",
    price: "$29",
    cadence: "/ workspace / mo",
    tagline: "For independent engineers and hardware duos.",
    features: [
      "Everything in Community",
      "Private Multi-CAD package uploads",
      "Interactive visual layer canvas",
      "Cross-revision Gerber diffing",
      "5GB storage included",
    ],
  },
  {
    key: "business",
    name: "Business",
    price: "$149",
    cadence: "/ workspace / mo",
    tagline: "For boutique design consultancies and engineering teams.",
    features: [
      "Everything in Team",
      "Cryptographically signed guest links",
      "Custom DFM rule profiles & constraints",
      "Unlimited active projects",
      "25GB storage & priority support",
    ],
  },
  {
    key: "pilot",
    name: "Paid Pilot",
    price: "$450",
    cadence: "/ org / mo (3 mos)",
    tagline: "Structured commercial onboarding for hardware organizations.",
    features: [
      "Everything in Business",
      "Hands-on CAD workflow integration",
      "Fabricator intake pipeline setup",
      "Dedicated Slack channel with team",
      "Custom rule profile development",
    ],
  },
];

export function PlanComparisonCard({
  currentTier = "community",
  workspaceId,
  hasStripeCustomer = false,
  billingMode = "stripe",
}: PlanComparisonCardProps) {
  const selfServeEnabled = billingMode !== "marketplace_free";
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const toast = useToast();

  async function handleUpgrade(tier: "team" | "business") {
    setLoadingTier(tier);

    try {
      const response = await fetch("/api/v1/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tier,
          interval: "month",
          workspaceId,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Checkout failed with HTTP ${response.status}`);
      }

      const { url } = (await response.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      toast.error("Could not open checkout", err instanceof Error ? err.message : undefined);
      setLoadingTier(null);
    }
  }

  async function handlePortal() {
    setPortalLoading(true);

    try {
      const response = await fetch("/api/v1/billing/portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Portal redirect failed with HTTP ${response.status}`);
      }

      const { url } = (await response.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      toast.error("Could not open the customer portal", err instanceof Error ? err.message : undefined);
      setPortalLoading(false);
    }
  }

  return (
    <div className="plan-comparison-container flex flex-col gap-4">
      {hasStripeCustomer && selfServeEnabled && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted p-3">
          <div>
            <strong className="text-sm font-medium text-foreground">Billing Subscription Managed via Stripe</strong>
            <p className="text-xs text-muted-foreground">Update payment methods, view invoices, or modify seats.</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="manage-portal-button"
            disabled={portalLoading}
            onClick={handlePortal}
          >
            {portalLoading ? "Opening..." : "Manage Subscription"}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((plan) => {
          const isCurrent = plan.key === currentTier;
          const canUpgrade = !isCurrent && (plan.key === "team" || plan.key === "business");

          return (
            <div
              key={plan.key}
              className={`plan-tier-card flex flex-col gap-3 rounded-md border p-4 ${isCurrent ? "border-primary" : "border-border"} bg-card`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-bold text-foreground">{plan.name}</h3>
                  {isCurrent && <Badge className="current-plan-badge">Current Plan</Badge>}
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-foreground">{plan.price}</span>
                  <span className="text-xs text-muted-foreground">{plan.cadence}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
              </div>

              <ul className="flex flex-1 flex-col gap-1.5 text-sm text-foreground">
                {plan.features.map((feat) => (
                  <li key={feat} className="flex items-start gap-2">
                    <svg
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-success"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      width="16"
                      height="16"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>

              <div>
                {isCurrent && (
                  <span className="inline-flex w-full items-center justify-center rounded-md border border-border px-4 py-2 text-sm text-muted-foreground">
                    Active Plan
                  </span>
                )}

                {canUpgrade &&
                  (selfServeEnabled ? (
                    <Button
                      type="button"
                      className="upgrade-checkout-button w-full"
                      disabled={loadingTier === plan.key}
                      onClick={() => handleUpgrade(plan.key as "team" | "business")}
                    >
                      {loadingTier === plan.key ? "Opening Stripe..." : `Upgrade to ${plan.name}`}
                    </Button>
                  ) : (
                    <a
                      href="https://github.com/marketplace/actions/boardreadyops"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex w-full items-center justify-center rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
                    >
                      Managed through GitHub Marketplace
                    </a>
                  ))}

                {!isCurrent && !canUpgrade && (
                  <a
                    href="mailto:pilot@boardreadyops.com?subject=Paid%20Pilot%20Inquiry"
                    className="inline-flex w-full items-center justify-center rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
                  >
                    Apply for Pilot
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
