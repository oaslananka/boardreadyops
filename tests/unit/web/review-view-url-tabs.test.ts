/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

const push = vi.fn();
let currentSearch = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/reviews/rev_gateway_42",
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

// Imported after the mock so review-view.tsx picks up the mocked module.
const { ReviewView } = await import("../../../apps/web/components/review/review-view.js");

type TestContainer = {
  querySelector(selector: string): { click(): void; getAttribute(name: string): string | null } | null;
  querySelectorAll(selector: string): Array<{ getAttribute(name: string): string | null; textContent: string | null }>;
  remove(): void;
};

type TestRuntime = {
  document: { body: { append(child: unknown): void }; createElement(tag: string): unknown };
};

describe("ReviewView tab state is URL-backed", () => {
  let container: TestContainer;
  let root: Root;
  const runtime = globalThis as unknown as TestRuntime & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const review = DEMO_REVIEWS[0] as (typeof DEMO_REVIEWS)[0];

  beforeEach(() => {
    push.mockClear();
    currentSearch = "";
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

  it("opens the tab named in ?tab= on initial render (the My Work CTA contract)", async () => {
    currentSearch = "tab=findings";
    await act(async () => {
      root.render(createElement(ReviewView, { initialReview: review }));
    });

    const findingsTab = container.querySelector('[role="tab"][id="tab-findings"]');
    expect(findingsTab?.getAttribute("aria-selected")).toBe("true");
    const overviewTab = container.querySelector('[role="tab"][id="tab-overview"]');
    expect(overviewTab?.getAttribute("aria-selected")).toBe("false");
  });

  it("defaults to overview when ?tab= is missing or unrecognized", async () => {
    currentSearch = "tab=not-a-real-tab";
    await act(async () => {
      root.render(createElement(ReviewView, { initialReview: review }));
    });

    expect(container.querySelector('[role="tab"][id="tab-overview"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("pushes a new URL with ?tab=discussion when the Discussion tab is selected", async () => {
    await act(async () => {
      root.render(createElement(ReviewView, { initialReview: review }));
    });

    const discussionTab = container.querySelector('[role="tab"][id="tab-discussion"]');
    if (!discussionTab) throw new Error("discussion tab not found");
    await act(async () => {
      discussionTab.click();
    });

    expect(push).toHaveBeenCalledWith("/reviews/rev_gateway_42?tab=discussion", { scroll: false });
  });

  it("omits the tab param entirely when navigating back to overview", async () => {
    currentSearch = "tab=findings";
    await act(async () => {
      root.render(createElement(ReviewView, { initialReview: review }));
    });

    const overviewTab = container.querySelector('[role="tab"][id="tab-overview"]');
    if (!overviewTab) throw new Error("overview tab not found");
    await act(async () => {
      overviewTab.click();
    });

    expect(push).toHaveBeenCalledWith("/reviews/rev_gateway_42", { scroll: false });
  });
});
