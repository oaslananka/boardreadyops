"use client";

import { useState } from "react";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";

export type CommercialTierKey = "community" | "team" | "business" | "pilot" | "enterprise";

export type PlanComparisonCardProps = Readonly<{
  currentTier?: CommercialTierKey;
  workspaceId?: string;
  hasStripeCustomer?: boolean;
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
}: PlanComparisonCardProps) {
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleUpgrade(tier: "team" | "business") {
    setLoadingTier(tier);
    setErrorMessage(null);

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
      setErrorMessage(err instanceof Error ? err.message : "Failed to open checkout");
      setLoadingTier(null);
    }
  }

  async function handlePortal() {
    setPortalLoading(true);
    setErrorMessage(null);

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
      setErrorMessage(err instanceof Error ? err.message : "Failed to open customer portal");
      setPortalLoading(false);
    }
  }

  return (
    <div className="plan-comparison-container flex flex-col gap-4">
      {hasStripeCustomer && (
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

      {errorMessage && (
        <div
          className="rounded-md border border-danger/40 bg-danger-surface px-4 py-3 text-sm text-danger"
          role="alert"
        >
          {errorMessage}
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

                {canUpgrade && (
                  <Button
                    type="button"
                    className="upgrade-checkout-button w-full"
                    disabled={loadingTier === plan.key}
                    onClick={() => handleUpgrade(plan.key as "team" | "business")}
                  >
                    {loadingTier === plan.key ? "Opening Stripe..." : `Upgrade to ${plan.name}`}
                  </Button>
                )}

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
