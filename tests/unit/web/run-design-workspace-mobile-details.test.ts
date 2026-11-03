/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { RunDesignWorkspace } from "../../../apps/web/components/run-design-workspace.js";

const commitSha = "a".repeat(40);
const snapshots = [
  {
    id: "source-layer",
    name: "kicad_native_F_Cu.svg",
    kind: "pcb_layer" as const,
    format: "svg" as const,
    sheetOrLayer: "F.Cu",
    width: 100,
    height: 100,
    content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>',
    sha256: "b".repeat(64),
    anchors: [],
  },
];
const findings = [
  {
    id: "row-1",
    fingerprint: "fingerprint-one",
    ruleId: "release.changelog-present",
    severity: "medium",
    message: "CHANGELOG.md is missing.",
    path: "CHANGELOG.md",
  },
  {
    id: "row-2",
    fingerprint: "fingerprint-two",
    ruleId: "design.board-outline",
    severity: "high",
    message: "PCB outline is open.",
    path: "board.kicad_pcb",
  },
];

describe("mobile run design finding investigation", () => {
  it("reveals source-grounded guidance beneath the selected finding without displacing desktop inspector", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () =>
        root.render(
          createElement(RunDesignWorkspace, {
            snapshots,
            findings,
            totalFindings: 14,
            repository: "example/hardware",
            commitSha,
          }),
        ),
      );
      const rows = Array.from(container.querySelectorAll<HTMLButtonElement>("aside ul button[aria-pressed]"));
      expect(rows).toHaveLength(2);
      expect(rows[0]?.getAttribute("aria-pressed")).toBe("true");
      const firstDetail = container.querySelector<HTMLElement>('section[aria-label="Selected finding details"]');
      expect(firstDetail?.closest("li")?.contains(rows[0] ?? null)).toBe(true);
      expect(firstDetail?.textContent).toContain("Add or update CHANGELOG.md");
      expect(firstDetail?.innerHTML).toContain("/blob/");
      expect(firstDetail?.textContent).toContain("No verified image coordinate");
      expect(firstDetail?.className).toContain("xl:hidden");
      expect(container.querySelector<HTMLElement>('aside[aria-label="Selected run finding"]')?.className).toContain(
        "xl:block",
      );

      await act(async () => rows[1]?.click());
      const nextDetail = container.querySelector<HTMLElement>('section[aria-label="Selected finding details"]');
      expect(rows[0]?.getAttribute("aria-pressed")).toBe("false");
      expect(rows[1]?.getAttribute("aria-pressed")).toBe("true");
      expect(container.querySelectorAll('section[aria-label="Selected finding details"]')).toHaveLength(1);
      expect(nextDetail?.closest("li")?.contains(rows[1] ?? null)).toBe(true);
      expect(nextDetail?.textContent).toContain("design.board-outline");
      expect(nextDetail?.innerHTML).toContain(`https://github.com/example/hardware/blob/${commitSha}/board.kicad_pcb`);
      expect(nextDetail?.textContent).not.toContain("Add or update CHANGELOG.md");
      expect(nextDetail?.textContent).toContain("No verified image coordinate");
      expect(container.querySelector('aside[aria-label="Selected run finding"]')?.textContent).toContain(
        "design.board-outline",
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });
});
