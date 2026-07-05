import { describe, expect, it } from "vitest";
import {
  buildLifecycleSummary,
  classifyLifecycleStatus,
  LIFECYCLE_RISK,
  lifecycleFromBomField,
  lifecycleFromDatabase,
} from "../../../src/bom/lifecycle.js";

describe("classifyLifecycleStatus", () => {
  it.each([
    ["EOL", "eol"],
    ["eol", "eol"],
    ["End Of Life", "eol"],
    ["end-of-life", "eol"],
    ["Obsolete", "obsolete"],
    ["OBSOLETE", "obsolete"],
    ["discontinued", "obsolete"],
    ["NRND", "nrnd"],
    ["nrnd", "nrnd"],
    ["Not Recommended", "nrnd"],
    ["not-recommended", "nrnd"],
    ["Not Recommended for New Design", "nrnd"],
    ["Not Recommended for New Designs", "nrnd"],
    ["preview", "nrnd"],
    ["Engineering Sample", "nrnd"],
    ["Active", "active"],
    ["active", "active"],
    ["In Production", "active"],
    ["production", "active"],
    ["", "unknown"],
    ["   ", "unknown"],
    [undefined, "unknown"],
    [null, "unknown"],
    ["some-custom-status", "custom"],
    ["TBD", "custom"],
  ] as const)("classifies %s as %s", (raw, expected) => {
    expect(classifyLifecycleStatus(raw as string)).toBe(expected);
  });
});

describe("LIFECYCLE_RISK", () => {
  it("maps active to none risk", () => {
    expect(LIFECYCLE_RISK.active).toBe("none");
  });

  it("maps nrnd to medium risk", () => {
    expect(LIFECYCLE_RISK.nrnd).toBe("medium");
  });

  it("maps eol to high risk", () => {
    expect(LIFECYCLE_RISK.eol).toBe("high");
  });

  it("maps obsolete to critical risk", () => {
    expect(LIFECYCLE_RISK.obsolete).toBe("critical");
  });

  it("maps unknown to info (not silently safe)", () => {
    expect(LIFECYCLE_RISK.unknown).toBe("info");
  });

  it("maps custom to info", () => {
    expect(LIFECYCLE_RISK.custom).toBe("info");
  });
});

describe("lifecycleFromBomField", () => {
  it("sets sourceType to bom-field", () => {
    const meta = lifecycleFromBomField("EOL");
    expect(meta.sourceType).toBe("bom-field");
    expect(meta.status).toBe("eol");
    expect(meta.raw).toBe("EOL");
  });
});

describe("lifecycleFromDatabase", () => {
  it("sets sourceType to lifecycle-db", () => {
    const meta = lifecycleFromDatabase("NRND");
    expect(meta.sourceType).toBe("lifecycle-db");
    expect(meta.status).toBe("nrnd");
  });
});

describe("buildLifecycleSummary", () => {
  it("counts statuses correctly", () => {
    const summary = buildLifecycleSummary(["active", "active", "nrnd", "eol", "obsolete", "unknown", "custom"]);
    expect(summary.activeCount).toBe(2);
    expect(summary.nrndCount).toBe(1);
    expect(summary.eolCount).toBe(1);
    expect(summary.obsoleteCount).toBe(1);
    expect(summary.unknownCount).toBe(1);
    expect(summary.customCount).toBe(1);
  });

  it("returns worst-case risk as critical when obsolete is present", () => {
    const summary = buildLifecycleSummary(["active", "nrnd", "obsolete"]);
    expect(summary.worstRisk).toBe("critical");
  });

  it("returns worst-case risk as high when only eol present", () => {
    const summary = buildLifecycleSummary(["active", "eol"]);
    expect(summary.worstRisk).toBe("high");
  });

  it("returns none for all-active components", () => {
    const summary = buildLifecycleSummary(["active", "active"]);
    expect(summary.worstRisk).toBe("none");
  });

  it("returns none for empty input", () => {
    const summary = buildLifecycleSummary([]);
    expect(summary.worstRisk).toBe("none");
  });
});
