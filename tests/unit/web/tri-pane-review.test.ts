/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TriPaneReviewLayout } from "../../../apps/web/components/review/tri-pane-layout.js";

describe("TriPaneReviewLayout", () => {
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

  const sampleFindings = [
    {
      id: "find_01",
      ruleId: "DFM-TRACE-MIN-WIDTH",
      message: "Trace width 0.12mm is below manufacturer minimum 0.15mm",
      severity: "error" as const,
      category: "clearance",
      layer: "F.Cu",
      coordinates: { x: 12.5, y: 34.2 },
      correctiveGuidance: "Widen track in CAD layout to at least 0.15mm or adjust netclass constraints.",
      diffStatus: "new" as const,
    },
    {
      id: "find_02",
      ruleId: "DFM-SILK-OVER-PAD",
      message: "Silkscreen legend overlaps surface mount component pad",
      severity: "warning" as const,
      category: "silkscreen",
      layer: "F.SilkS",
      coordinates: { x: 50.1, y: 18.0 },
      correctiveGuidance: "Move silkscreen reference designator away from SMD pad boundaries.",
      diffStatus: "pre-existing" as const,
    },
  ];

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

  it("renders all three panes on desktop: left findings pane, center board canvas, right detail pane", async () => {
    await act(async () => {
      root.render(
        createElement(TriPaneReviewLayout, {
          findings: sampleFindings,
        }),
      );
    });

    const leftPane = container.querySelector('.tri-pane[data-pane="findings"]');
    const centerPane = container.querySelector('.tri-pane[data-pane="board"]');
    const rightPane = container.querySelector('.tri-pane[data-pane="details"]');

    expect(leftPane).not.toBeNull();
    expect(centerPane).not.toBeNull();
    expect(rightPane).not.toBeNull();
  });

  it("provides mobile responsive tab navigation buttons for Findings, Board, and Details", async () => {
    await act(async () => {
      root.render(
        createElement(TriPaneReviewLayout, {
          findings: sampleFindings,
        }),
      );
    });

    const mobileTabs = container.querySelectorAll(".mobile-pane-tab");
    expect(mobileTabs.length).toBe(3);
    const tabLabels = Array.from(mobileTabs).map((tab) => tab.textContent?.trim());
    expect(tabLabels).toContain("Findings");
    expect(tabLabels).toContain("Board");
    expect(tabLabels).toContain("Details");
  });

  it("displays selected finding details, CAD corrective guidance, and waiver form in the right pane", async () => {
    await act(async () => {
      root.render(
        createElement(TriPaneReviewLayout, {
          findings: sampleFindings,
          selectedFindingId: "find_01",
        }),
      );
    });

    const rightPane = container.querySelector('.tri-pane[data-pane="details"]');
    expect(rightPane?.textContent).toContain("DFM-TRACE-MIN-WIDTH");
    expect(rightPane?.textContent).toContain("0.12mm is below");
    expect(rightPane?.textContent).toContain("X: 12.50, Y: 34.20");
    expect(rightPane?.textContent).toContain("Widen track in CAD layout");
    expect(rightPane?.textContent).toContain("New in this revision");
    expect(container.querySelector(".waiver-form")).not.toBeNull();
  });

  it("triggers onWaiveFinding when submitting waiver form", async () => {
    const onWaive = vi.fn();
    await act(async () => {
      root.render(
        createElement(TriPaneReviewLayout, {
          findings: sampleFindings,
          selectedFindingId: "find_01",
          onWaiveFinding: onWaive,
        }),
      );
    });

    const waiveBtn = container.querySelector(".submit-waiver-button");
    expect(waiveBtn).not.toBeNull();
    await act(async () => {
      waiveBtn?.click();
    });

    expect(onWaive).toHaveBeenCalledWith("find_01", expect.objectContaining({ reason: expect.any(String) }));
  });
});
