/** @vitest-environment happy-dom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  matchingRecordedSchematicSheet,
  RunDesignWorkspace,
} from "../../../apps/web/components/run-design-workspace.js";

const schematic = {
  id: "schematic-source",
  name: "kicad_native_SparkFun_Qwiic_Navigation.svg",
  kind: "schematic" as const,
  format: "svg" as const,
  sheetOrLayer: "SparkFun_Qwiic_Navigation / SparkFun_Qwiic_Navigation",
  width: 100,
  height: 100,
  content: '<svg viewBox="0 0 100 100"><path id="source-schematic" /></svg>',
  sha256: "a".repeat(64),
  anchors: [],
};
const board = {
  ...schematic,
  id: "pcb-source",
  name: "kicad_native_F_Cu.svg",
  kind: "pcb_layer" as const,
  sheetOrLayer: "SparkFun_Qwiic_Navigation / F.Cu",
  content: '<svg viewBox="0 0 100 100"><path id="source-pcb" /></svg>',
};
const finding = {
  id: "run-finding-r8",
  fingerprint: "run-fingerprint-r8",
  ruleId: "bom.missing-mpn",
  severity: "high",
  message: "R8 is missing an MPN.",
  path: "SparkFun_Qwiic_Navigation.kicad_sch",
  kind: undefined,
  waivedAt: undefined,
};

describe("recorded source-backed schematic navigation", () => {
  it("matches only an exact, unique published schematic sheet, never a guessed location", () => {
    expect(matchingRecordedSchematicSheet("SparkFun_Qwiic_Navigation.kicad_sch", [board, schematic])).toBe(
      schematic.sheetOrLayer,
    );
    expect(matchingRecordedSchematicSheet("hardware\\SparkFun_Qwiic_Navigation.kicad_sch", [board, schematic])).toBe(
      schematic.sheetOrLayer,
    );
    expect(matchingRecordedSchematicSheet("unrelated.kicad_sch", [board, schematic])).toBeUndefined();
    expect(matchingRecordedSchematicSheet("SparkFun_Qwiic_Navigation.kicad_pcb", [board, schematic])).toBeUndefined();
    expect(
      matchingRecordedSchematicSheet("../SparkFun_Qwiic_Navigation.kicad_sch", [board, schematic]),
    ).toBeUndefined();
    expect(
      matchingRecordedSchematicSheet("SparkFun_Qwiic_Navigation.kicad_sch", [
        board,
        schematic,
        { ...schematic, id: "duplicate" },
      ]),
    ).toBeUndefined();
  });

  it("opens a matching published schematic when a real MPN finding is clicked, even after manual board selection", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () =>
        root.render(
          createElement(RunDesignWorkspace, {
            snapshots: [schematic, board],
            findings: [finding],
            totalFindings: 1,
            repository: "example/hardware",
            commitSha: "f".repeat(40),
          }),
        ),
      );
      const selector = container.querySelector<HTMLSelectElement>("#sheet-select");
      const findingButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        button.textContent?.includes(finding.message),
      );
      expect(selector?.value).toBe(board.sheetOrLayer);
      expect(findingButton).toBeDefined();
      await act(async () => findingButton?.click());
      expect(selector?.value).toBe(schematic.sheetOrLayer);
      expect(container.textContent).toContain("No verified image coordinate is linked");
      expect(container.querySelectorAll('button[aria-label*="source findings"]')).toHaveLength(0);

      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      await act(async () => {
        setter?.call(selector, board.sheetOrLayer);
        selector?.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(selector?.value).toBe(board.sheetOrLayer);
      await act(async () => findingButton?.click());
      expect(selector?.value).toBe(schematic.sheetOrLayer);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it("still follows a uniquely recorded PCB marker after a schematic source-sheet jump", async () => {
    const boardMarker = {
      id: "pcb-source-marker",
      kind: "finding" as const,
      x: 0.4,
      y: 0.6,
      metadata: { fingerprint: "exact-pcb-marker", ruleId: "design.board-outline", severity: "high" },
    };
    const pcbFinding = {
      ...finding,
      id: "pcb-defect",
      fingerprint: "exact-pcb-marker",
      message: "PCB outline is open.",
      path: "SparkFun_Qwiic_Navigation.kicad_pcb",
      ruleId: "design.board-outline",
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () =>
        root.render(
          createElement(RunDesignWorkspace, {
            snapshots: [schematic, { ...board, anchors: [boardMarker] }],
            findings: [pcbFinding, finding],
            totalFindings: 2,
            repository: "example/hardware",
            commitSha: "f".repeat(40),
          }),
        ),
      );
      const selector = container.querySelector<HTMLSelectElement>("#sheet-select");
      const card = (message: string) =>
        [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
          button.textContent?.includes(message),
        );
      expect(selector?.value).toBe(board.sheetOrLayer);
      await act(async () => card(finding.message)?.click());
      expect(selector?.value).toBe(schematic.sheetOrLayer);
      await act(async () => card(pcbFinding.message)?.click());
      expect(selector?.value).toBe(board.sheetOrLayer);
      expect(container.textContent).toContain("This finding has a recorded image anchor");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it("keeps the user-selected board when source-sheet matching is ambiguous or absent", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () =>
        root.render(
          createElement(RunDesignWorkspace, {
            snapshots: [schematic, { ...schematic, id: "duplicate" }, board],
            findings: [finding],
            totalFindings: 1,
            repository: "example/hardware",
            commitSha: "f".repeat(40),
          }),
        ),
      );
      const selector = container.querySelector<HTMLSelectElement>("#sheet-select");
      const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
        item.textContent?.includes(finding.message),
      );
      expect(selector?.value).toBe(board.sheetOrLayer);
      await act(async () => button?.click());
      expect(selector?.value).toBe(board.sheetOrLayer);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });
});
