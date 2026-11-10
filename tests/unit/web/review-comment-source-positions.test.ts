/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReviewDesignWorkspace } from "../../../apps/web/components/review/review-design-workspace.js";
import { ReviewView } from "../../../apps/web/components/review/review-view.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";
import { buildDemoSnapshots } from "../../../apps/web/lib/demo-snapshots.js";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/reviews/review-example",
  useSearchParams: () => new URLSearchParams("tab=changes"),
}));

const review = DEMO_REVIEWS[0];
if (!review) throw new Error("Review fixture missing");
const headSnapshots = buildDemoSnapshots(review.changedFiles, review.findings);
const reviewWithCanvas = { ...review, headSnapshots };

describe("review comments without published image coordinates", () => {
  it("does not invent board positions or clickable pins for finding-linked discussion comments", () => {
    expect(review.comments.some((comment) => Boolean(comment.findingFingerprint))).toBe(true);
    const html = renderToStaticMarkup(createElement(ReviewDesignWorkspace, { review: reviewWithCanvas }));
    expect(html).toContain('aria-label="Schematic and PCB Review Canvas"');
    expect(html).not.toContain("Comment by ");
    expect(html).not.toContain("💬");
  });

  it("routes the source-review Discussion action to the actual tab without writing data", async () => {
    push.mockClear();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => root.render(createElement(ReviewView, { initialReview: reviewWithCanvas })));
      const openDiscussion = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        button.textContent?.includes("Open Discussion"),
      );
      expect(openDiscussion).toBeDefined();
      await act(async () => openDiscussion?.click());
      expect(push).toHaveBeenCalledExactlyOnceWith("/reviews/review-example?tab=discussion", { scroll: false });
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it("keeps non-spatial comments reachable through the real Discussion tab instead", async () => {
    const onOpenDiscussion = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () =>
        root.render(createElement(ReviewDesignWorkspace, { review: reviewWithCanvas, onOpenDiscussion })),
      );
      const openDiscussion = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        button.textContent?.includes("Discussion"),
      );
      expect(openDiscussion?.textContent).toContain("Discussion");
      expect(container.textContent).toContain("comments");
      await act(async () => openDiscussion?.click());
      expect(onOpenDiscussion).toHaveBeenCalledOnce();
      expect(container.innerHTML).not.toContain("Comment by ");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });
});
