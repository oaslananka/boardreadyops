/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlanComparisonCard } from "../../../apps/web/components/billing/plan-comparison-card.js";

describe("PlanComparisonCard", () => {
  type TestElement = {
    click(): void;
    textContent: string | null;
    getAttribute(name: string): string | null;
  };
  type TestContainer = {
    querySelector(selector: string): TestElement | null;
    querySelectorAll(selector: string): TestElement[];
    remove(): void;
  };
  type TestRuntime = {
    document: { body: { append(child: unknown): void }; createElement(tag: string): unknown };
  };

  let container: TestContainer;
  let root: Root;
  const runtime = globalThis as unknown as TestRuntime & { IS_REACT_ACT_ENVIRONMENT?: boolean };

  beforeEach(() => {
    container = runtime.document.createElement("div") as TestContainer;
    runtime.document.body.append(container);
    root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
    runtime.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete runtime.IS_REACT_ACT_ENVIRONMENT;
  });

  it("renders all commercial tiers: Community, Team, Business, Paid Pilot", async () => {
    await act(async () => {
      root.render(
        createElement(PlanComparisonCard, {
          currentTier: "community",
          workspaceId: "ws_maker_01",
        }),
      );
    });

    const cards = container.querySelectorAll(".plan-tier-card");
    expect(cards.length).toBe(4);
    const text = container.querySelector(".plan-comparison-container")?.textContent;
    expect(text).toContain("Community");
    expect(text).toContain("Team");
    expect(text).toContain("Business");
    expect(text).toContain("Paid Pilot");
    expect(text).toContain("$29");
    expect(text).toContain("$149");
    expect(text).toContain("$450");
  });

  it("indicates current active plan and shows upgrade buttons for higher tiers", async () => {
    await act(async () => {
      root.render(
        createElement(PlanComparisonCard, {
          currentTier: "team",
          workspaceId: "ws_maker_01",
        }),
      );
    });

    const currentBadge = container.querySelector(".current-plan-badge");
    expect(currentBadge?.textContent).toContain("Current Plan");

    const upgradeButtons = container.querySelectorAll(".upgrade-checkout-button");
    expect(upgradeButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("shows Manage Subscription portal button when on paid plan", async () => {
    await act(async () => {
      root.render(
        createElement(PlanComparisonCard, {
          currentTier: "team",
          workspaceId: "ws_maker_01",
          hasStripeCustomer: true,
        }),
      );
    });

    const portalBtn = container.querySelector(".manage-portal-button");
    expect(portalBtn).not.toBeNull();
    expect(portalBtn?.textContent).toContain("Manage Subscription");
  });
});
