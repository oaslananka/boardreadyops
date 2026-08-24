import { describe, expect, it } from "vitest";
import {
  componentKey,
  createNullComponentIntelligenceProvider,
  isRiskyLifecycleStatus,
  queryablePartsOf,
  supplyFindingSeverity,
} from "../../../packages/cloud-core/src/component-intelligence.js";

describe("component intelligence", () => {
  it("answers nothing until a provider is configured", async () => {
    const provider = createNullComponentIntelligenceProvider();
    expect(provider.name).toBe("none");
    await expect(provider.lookup([{ mpn: "STM32F103C8T6" }])).resolves.toEqual([]);
  });

  it("treats only sourcing-risk states as risky", () => {
    expect(isRiskyLifecycleStatus("nrnd")).toBe(true);
    expect(isRiskyLifecycleStatus("eol")).toBe(true);
    expect(isRiskyLifecycleStatus("obsolete")).toBe(true);
    expect(isRiskyLifecycleStatus("active")).toBe(false);
    expect(isRiskyLifecycleStatus("unknown")).toBe(false);
  });

  it("escalates severity with how unavailable the part already is", () => {
    expect(supplyFindingSeverity("obsolete")).toBe("critical");
    expect(supplyFindingSeverity("eol")).toBe("high");
    expect(supplyFindingSeverity("nrnd")).toBe("medium");
  });

  it("matches a part regardless of case and surrounding whitespace", () => {
    expect(componentKey({ mpn: " STM32F103C8T6 ", manufacturer: "ST" })).toBe(
      componentKey({ mpn: "stm32f103c8t6", manufacturer: "st" }),
    );
  });

  it("distinguishes the same part number from different manufacturers", () => {
    expect(componentKey({ mpn: "RC0603", manufacturer: "Yageo" })).not.toBe(
      componentKey({ mpn: "RC0603", manufacturer: "Vishay" }),
    );
  });

  it("collapses duplicate parts into one query", () => {
    const parts = queryablePartsOf([
      { mpn: "STM32F103C8T6", manufacturer: "ST" },
      { mpn: "stm32f103c8t6", manufacturer: "st" },
      { mpn: "RC0603FR-0710KL", manufacturer: "Yageo" },
    ]);

    expect(parts).toHaveLength(2);
  });

  it("drops components with no part number rather than querying on nothing", () => {
    const parts = queryablePartsOf([{ mpn: "STM32F103C8T6" }, { mpn: "   " }, { manufacturer: "ST" }, {}]);

    expect(parts).toEqual([{ mpn: "STM32F103C8T6" }]);
  });
});
