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
  it("opens the real PCB layer before a schematic when both are published for this run", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      const pcb = snapshots[0];
      if (!pcb) throw new Error("PCB snapshot missing");
      const schematic = {
        ...pcb,
        id: "schematic",
        name: "kicad_native_main_sch.svg",
        kind: "schematic" as const,
        sheetOrLayer: "Main schematic",
      };
      await act(async () => {
        root.render(
          createElement(RunDesignWorkspace, {
            snapshots: [schematic, pcb],
            findings,
            totalFindings: 14,
            repository: "example/hardware",
            commitSha,
          }),
        );
      });
      const layerPicker = container.querySelector<HTMLSelectElement>("#sheet-select");
      expect(layerPicker?.value).toBe("F.Cu");
      expect([...(layerPicker?.options ?? [])].map((option) => option.value)).toEqual(["Main schematic", "F.Cu"]);
      expect(container.querySelector('[aria-label="Schematic and PCB Review Canvas"]')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it("opens the matching persisted finding from its canvas marker but never renders an out-of-page marker", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      const firstSnapshot = snapshots[0];
      if (!firstSnapshot) throw new Error("source snapshot is missing");
      const marker = (id: string, fingerprint: string) => ({
        id,
        kind: "finding" as const,
        targetRef: id,
        x: 0.4,
        y: 0.6,
        metadata: { fingerprint, ruleId: "design.board-outline", severity: "high" },
      });
      await act(async () =>
        root.render(
          createElement(RunDesignWorkspace, {
            snapshots: [
              { ...firstSnapshot, anchors: [marker("K1", "fingerprint-two"), marker("STALE", "not-on-page")] },
            ],
            findings,
            totalFindings: 14,
            repository: "example/hardware",
            commitSha,
          }),
        ),
      );
      expect(container.querySelector('button[title*="not-on-page"]')).toBeNull();
      expect(container.textContent).not.toContain("STALE");
      const canvasMarker = container.querySelector<HTMLButtonElement>('button[title^="Finding: design.board-outline"]');
      expect(canvasMarker?.textContent).toContain("K1");
      await act(async () => canvasMarker?.click());
      const selectedRow = container.querySelector<HTMLButtonElement>('aside ul button[aria-pressed="true"]');
      expect(selectedRow?.textContent).toContain("PCB outline is open");
      const detail = container.querySelector<HTMLElement>('section[aria-label="Selected finding details"]');
      expect(detail?.textContent).toContain("This finding has a recorded image anchor");
      expect(detail?.innerHTML).toContain(`/blob/${commitSha}/board.kicad_pcb`);
      expect(container.querySelector('button[title^="Finding: design.board-outline"]')?.className).toContain(
        "ring-2 ring-primary",
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });

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
