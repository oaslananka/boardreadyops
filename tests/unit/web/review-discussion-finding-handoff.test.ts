/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DiscussionTab } from "../../../apps/web/components/review/discussion-tab.js";
import { ReviewView } from "../../../apps/web/components/review/review-view.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

const nav = vi.hoisted(() => ({ push: vi.fn(), searchParams: new URLSearchParams("tab=discussion") }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/reviews/review-example",
  useSearchParams: () => nav.searchParams,
}));

const review = DEMO_REVIEWS[0];
if (!review) throw new Error("Expected published review fixture");
const linkedComment = review.comments.find((comment) => comment.findingFingerprint);
if (!linkedComment?.findingFingerprint) throw new Error("Expected a finding-linked comment");
const linkedFinding = review.findings.find((finding) => finding.fingerprint === linkedComment.findingFingerprint);
if (!linkedFinding) throw new Error("Expected a real recorded finding");

describe("source-linked discussion to actual finding", () => {
  it("provides a useful recorded finding label and a keyboard-operable Inspect finding action", () => {
    const html = renderToStaticMarkup(
      createElement(DiscussionTab, {
        comments: [linkedComment],
        findings: review.findings,
        readOnly: true,
        onInspectFinding: vi.fn(),
      }),
    );
    expect(html).toContain(linkedFinding.ruleId);
    expect(html).toContain("Inspect finding");
    expect(html).toContain(`aria-label="Inspect recorded finding ${linkedFinding.ruleId}"`);
    expect(html).not.toContain("Anchored to Finding");
    expect(html).not.toContain(linkedFinding.fingerprint);
  });

  it("cannot navigate or invent details for a fingerprint absent from this Review", () => {
    const html = renderToStaticMarkup(
      createElement(DiscussionTab, {
        comments: [{ ...linkedComment, findingFingerprint: "missing-record-123" }],
        findings: review.findings,
        readOnly: true,
        onInspectFinding: vi.fn(),
      }),
    );
    expect(html).toContain("Linked finding is unavailable in this Review");
    expect(html).not.toContain("Inspect finding");
    expect(html).not.toContain("missing-record-123");
  });

  it("opens the existing Changes inspector from a read-only discussion without mutation", async () => {
    nav.push.mockClear();
    nav.searchParams = new URLSearchParams("tab=discussion");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => root.render(createElement(ReviewView, { initialReview: review, readOnly: true })));
      const inspect = [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
        b.textContent?.includes("Inspect finding"),
      );
      expect(inspect).toBeDefined();
      expect(container.textContent).toContain(linkedFinding.ruleId);
      await act(async () => inspect?.click());
      expect(nav.push).toHaveBeenCalledExactlyOnceWith("/reviews/review-example?tab=changes", { scroll: false });
      nav.searchParams = new URLSearchParams("tab=changes");
      await act(async () => root.render(createElement(ReviewView, { initialReview: review, readOnly: true })));
      const inspector = container.querySelector<HTMLElement>('aside[aria-label="Selected finding inspector"]');
      expect(inspector?.textContent).toContain(linkedFinding.message);
      expect(container.textContent).not.toContain("Post Comment");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });
});
