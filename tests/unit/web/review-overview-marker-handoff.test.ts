/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ChangesTab } from "../../../apps/web/components/review/changes-tab.js";
import { OverviewTab } from "../../../apps/web/components/review/overview-tab.js";
import { ReviewView } from "../../../apps/web/components/review/review-view.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/reviews/rev_marker",
  useSearchParams: () => new URLSearchParams(),
}));

const base = DEMO_REVIEWS[0];
if (!base) throw new Error("Review fixture missing");
const blocking = base.findings.find((finding) => finding.severity === "error");
const warning = base.findings.find((finding) => finding.severity === "warning");
if (!blocking || !warning) throw new Error("Review fixture requires error and warning findings");

const review = {
  ...base,
  findings: [blocking, warning],
  headSnapshots: [
    {
      id: "head-pcb",
      name: "kicad_native_marker.svg",
      kind: "pcb_layer" as const,
      format: "svg" as const,
      sheetOrLayer: "example / F.Cu",
      width: 400,
      height: 320,
      sha256: "a".repeat(64),
      content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 320"></svg>',
      anchors: [
        {
          id: "marker-warning",
          kind: "finding" as const,
          targetRef: "SW2",
          x: 0.4,
          y: 0.5,
          metadata: { fingerprint: warning.fingerprint, ruleId: warning.ruleId, severity: warning.severity },
        },
      ],
    },
  ],
  baseSnapshots: [],
};

describe("Review overview marker handoff", () => {
  it("routes an overview marker click to the interactive Changes canvas instead of doing nothing", async () => {
    push.mockClear();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => root.render(createElement(ReviewView, { initialReview: review })));
      const marker = container.querySelector<HTMLButtonElement>('button[title*="Finding:"]');
      expect(marker?.textContent).toContain("SW2");
      await act(async () => marker?.click());
      expect(push).toHaveBeenCalledWith("/reviews/rev_marker?tab=changes", { scroll: false });
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it("opens the exact selected source finding instead of leaving an inert overview marker", async () => {
    const onInspectFinding = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => root.render(createElement(OverviewTab, { review, onInspectFinding })));
      const marker = container.querySelector<HTMLButtonElement>('button[title*="Finding:"]');
      expect(marker?.textContent).toContain("SW2");
      await act(async () => marker?.click());
      expect(onInspectFinding).toHaveBeenCalledExactlyOnceWith(warning.fingerprint);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it("opens an explicitly selected nonblocking marker in the full Changes inspector", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () =>
        root.render(createElement(ChangesTab, { review, initialFindingFingerprint: warning.fingerprint })),
      );
      const inspector = container.querySelector('aside[aria-label="Selected finding inspector"]');
      expect(inspector?.textContent).toContain(warning.message);
      const all = [...container.querySelectorAll<HTMLButtonElement>("button")].find((el) =>
        el.textContent?.includes("All (2)"),
      );
      expect(all?.getAttribute("aria-pressed")).toBe("true");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });
});
