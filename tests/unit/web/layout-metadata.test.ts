import { describe, expect, it } from "vitest";
import { metadata as dashboardMetadata } from "../../../apps/web/app/dashboard/page.js";
import { metadata as evidenceMetadata } from "../../../apps/web/app/evidence/page.js";
import { metadata as insightsMetadata } from "../../../apps/web/app/insights/page.js";
import { metadata } from "../../../apps/web/app/layout.js";
import { metadata as policiesMetadata } from "../../../apps/web/app/policies/page.js";
import { metadata as reviewsMetadata } from "../../../apps/web/app/reviews/page.js";
import { metadata as billingMetadata } from "../../../apps/web/app/settings/billing/page.js";
import { metadata as componentIntelligenceMetadata } from "../../../apps/web/app/settings/component-intelligence/page.js";
import { metadata as dataMetadata } from "../../../apps/web/app/settings/data/page.js";
import { metadata as securityMetadata } from "../../../apps/web/app/settings/security/page.js";
import { metadata as tokensMetadata } from "../../../apps/web/app/settings/tokens/page.js";
import { metadata as setupMetadata } from "../../../apps/web/app/setup/page.js";
import { metadata as workMetadata } from "../../../apps/web/app/work/page.js";

describe("root layout metadata", () => {
  it("does not apply a homepage canonical to child application routes", () => {
    expect(metadata.alternates?.canonical).toBeUndefined();
  });

  it("sets metadataBase for absolute asset URLs", () => {
    expect(metadata.metadataBase?.toString()).toBe("https://boardreadyops.com/");
  });

  it("keeps the existing page title template", () => {
    expect(metadata.title).toEqual({ default: "BoardReadyOps Cloud", template: "%s · BoardReadyOps" });
  });

  it("sets Open Graph fields for social sharing", () => {
    expect(metadata.openGraph?.title).toBe("BoardReadyOps — Know what stands between your board and production.");
    expect(metadata.openGraph?.url).toBe("https://boardreadyops.com");
    expect((metadata.openGraph as { type?: string })?.type).toBe("website");
  });

  it("sets a large-image Twitter card", () => {
    expect((metadata.twitter as { card?: string })?.card).toBe("summary_large_image");
  });
});

describe("child page titles don't duplicate the root template's brand suffix", () => {
  const childPageTitles: Record<string, unknown> = {
    dashboard: dashboardMetadata.title,
    evidence: evidenceMetadata.title,
    insights: insightsMetadata.title,
    policies: policiesMetadata.title,
    reviews: reviewsMetadata.title,
    "settings/billing": billingMetadata.title,
    "settings/component-intelligence": componentIntelligenceMetadata.title,
    "settings/data": dataMetadata.title,
    "settings/security": securityMetadata.title,
    "settings/tokens": tokensMetadata.title,
    setup: setupMetadata.title,
    work: workMetadata.title,
  };

  for (const [route, title] of Object.entries(childPageTitles)) {
    it(`${route} title does not already contain "· BoardReadyOps" (the root template adds it)`, () => {
      expect(typeof title).toBe("string");
      expect(title as string).not.toContain("BoardReadyOps");
    });
  }
});
