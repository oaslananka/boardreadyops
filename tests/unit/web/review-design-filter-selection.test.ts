/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ReviewDesignWorkspace } from "../../../apps/web/components/review/review-design-workspace.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

const fixture = DEMO_REVIEWS[0];
if (!fixture) throw new Error("Review fixture missing");
const blocker = fixture.findings.find((f) => f.severity === "error" && f.disposition === "open");
const warning = fixture.findings.find((f) => f.severity === "warning" && f.disposition !== "open");
if (!blocker || !warning) throw new Error("Review fixture must include blocking and nonblocking findings");
const review = {
  ...fixture,
  findings: [blocker, warning],
  headSnapshots: [
    {
      id: "linked-summary",
      name: "summary.svg",
      kind: "pcb_layer" as const,
      format: "svg" as const,
      sheetOrLayer: "F.Cu",
      width: 1000,
      height: 800,
      content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800"><rect width="1000" height="800"/></svg>',
      sha256: "a".repeat(64),
      anchors: [blocker, warning].map((finding, i) => ({
        id: `finding-${i}`,
        kind: "finding" as const,
        targetRef: finding.component,
        x: 0.25 + i * 0.5,
        y: 0.5,
        metadata: { fingerprint: finding.fingerprint, ruleId: finding.ruleId, severity: finding.severity },
      })),
    },
  ],
};

describe("Review finding filter and canvas selection", () => {
  it("highlights only the visible inspected finding when a filter hides the previously selected marker", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const button = (label: string) =>
      [...container.querySelectorAll("button")].find((node) => node.textContent?.includes(label));
    const row = (fingerprint: string) =>
      [...container.querySelectorAll("button[aria-pressed]")].find((node) =>
        node.textContent?.includes(fingerprint === blocker.fingerprint ? blocker.message : warning.message),
      );
    const marker = (ruleId: string) =>
      [...container.querySelectorAll('button[title^="Finding:"]')].find((node) =>
        node.getAttribute("title")?.includes(ruleId),
      );
    const inspector = () =>
      container.querySelector('aside[aria-label="Selected finding inspector"]')?.textContent ?? "";
    try {
      await act(async () => root.render(createElement(ReviewDesignWorkspace, { review })));
      await act(async () => button("All (2)")?.click());
      await act(async () => row(warning.fingerprint)?.click());
      expect(inspector()).toContain(warning.ruleId);
      expect(row(warning.fingerprint)?.getAttribute("aria-pressed")).toBe("true");

      await act(async () => button("Blockers (1)")?.click());
      expect(inspector()).toContain(blocker.ruleId);
      expect(row(blocker.fingerprint)?.getAttribute("aria-pressed")).toBe("true");
      expect(marker(blocker.ruleId)?.className).toContain("ring-2 ring-primary");
      expect(marker(warning.ruleId)?.className).not.toContain("ring-2 ring-primary");

      // Selecting a real source marker hidden by the blocker filter must reveal it
      // in the list and return the inspector and canvas to the same fingerprint.
      await act(async () => marker(warning.ruleId)?.click());
      expect(button("All (2)")?.getAttribute("aria-pressed")).toBe("true");
      expect(inspector()).toContain(warning.ruleId);
      expect(row(warning.fingerprint)?.getAttribute("aria-pressed")).toBe("true");
      expect(marker(warning.ruleId)?.className).toContain("ring-2 ring-primary");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });
});
