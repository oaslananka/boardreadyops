import { describe, expect, it } from "vitest";
import { touchTargetName } from "../../../qa/audit/touch-target-name.js";

/**
 * The audit's touch-target finding is only useful if it names the control an operator has to go
 * and find. It used to read `aria-label` and text content but not `aria-labelledby`, so a
 * correctly labelled switch was reported as `"BUTTON"` — which cost real time to identify,
 * because that control renders client-side only and never appears in the served HTML.
 *
 * The resolution now runs in Node rather than inside `page.evaluate`, so it can be checked here
 * instead of only through a browser run.
 */

const candidate = (overrides: Partial<Parameters<typeof touchTargetName>[0]>) => ({
  ariaLabel: "",
  labelledByText: "",
  text: "",
  title: "",
  tag: "BUTTON",
  width: 32,
  height: 18,
  reachable: false,
  ...overrides,
});

describe("touchTargetName", () => {
  it("prefers an explicit aria-label", () => {
    expect(touchTargetName(candidate({ ariaLabel: "Open navigation", text: "menu" }))).toBe("Open navigation");
  });

  it("falls back to the text an aria-labelledby points at", () => {
    // The theme switch's name comes entirely from a sibling span; without this it read as "BUTTON".
    expect(touchTargetName(candidate({ labelledByText: "Dark" }))).toBe("Dark");
  });

  it("falls back to the control's own text", () => {
    expect(touchTargetName(candidate({ text: "Load dead letters" }))).toBe("Load dead letters");
  });

  it("falls back to a title before giving up", () => {
    expect(touchTargetName(candidate({ title: "Collapse navigation" }))).toBe("Collapse navigation");
  });

  it("reports the tag when a control has no accessible name at all", () => {
    // Not a fallback so much as a second finding: a control with nothing to call it is a problem
    // in its own right, and the tag is what an operator has left to search for.
    expect(touchTargetName(candidate({}))).toBe("BUTTON");
  });

  it("keeps a finding on one line", () => {
    const long = "x".repeat(120);
    expect(touchTargetName(candidate({ text: long })).length).toBe(40);
  });
});
