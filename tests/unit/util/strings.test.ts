import { describe, expect, it } from "vitest";
import { compareCodePoints, stableStringify } from "../../../src/util/strings.js";

describe("compareCodePoints", () => {
  it("orders the same way regardless of the machine's locale", () => {
    const names = ["idf", "Izmir", "ipsum", "IPSUM", "i2c_bus", "ILI9341", "esp_timer"];
    const ours = [...names].sort(compareCodePoints);

    // The reason this function exists. Turkish collation orders the dotted and dotless I
    // differently, so localeCompare gives a tr-TR machine a different order from CI:
    //   en-US  esp_timer i2c_bus idf ILI9341 ipsum IPSUM Izmir
    //   tr-TR  esp_timer ILI9341 IPSUM Izmir i2c_bus idf ipsum
    // A bill of materials that reorders by machine makes every diff noise. See #795.
    const turkish = [...names].sort((a, b) => a.localeCompare(b, "tr-TR"));
    const english = [...names].sort((a, b) => a.localeCompare(b, "en-US"));
    expect(turkish).not.toEqual(english);

    expect(ours).toEqual(["ILI9341", "IPSUM", "Izmir", "esp_timer", "i2c_bus", "idf", "ipsum"]);
    for (const locale of ["en-US", "tr-TR", "de-DE", "sv-SE"]) {
      expect([...names].sort(compareCodePoints), locale).toEqual(ours);
    }
  });

  it("returns zero for equal strings and is antisymmetric", () => {
    expect(compareCodePoints("a", "a")).toBe(0);
    expect(compareCodePoints("a", "b")).toBe(-1);
    expect(compareCodePoints("b", "a")).toBe(1);
  });

  it("orders beyond the basic multilingual plane without throwing", () => {
    expect([..."🙂b", "a"].sort(compareCodePoints).length).toBe(3);
  });
});

describe("stableStringify key order", () => {
  it("orders keys independently of the machine's locale", () => {
    // These are real rule detail keys, and they are exactly the pair that diverges: under
    // `lt-LT`, `missingCategory` sorts before `missingCategories`. This feeds fingerprintFor,
    // so on a Lithuanian-locale machine a finding's fingerprint differed from CI's and any
    // waiver keyed on it silently stopped matching. See #795.
    const value = { missingCategories: ["a"], missingCategory: "b", mpn: "X", missingRefs: [] };

    expect(stableStringify(value)).toBe('{"missingCategories":["a"],"missingCategory":"b","missingRefs":[],"mpn":"X"}');
  });

  it("orders the az-AZ divergent pair the same way too", () => {
    // Under `az-AZ`, `fix` sorts before `filename`.
    expect(stableStringify({ filename: "a", firmware: "b", fix: "c" })).toBe(
      '{"filename":"a","firmware":"b","fix":"c"}',
    );
  });

  it("keeps the order the common locales already produced", () => {
    const keys = ["missingCategories", "missingCategory", "missingRefs", "mpn", "filename", "firmware", "fix"];
    const ours = [...keys].sort(compareCodePoints);

    // The fix is corrective, not disruptive: it reproduces what en-US, de-DE and sv-SE already
    // gave, so fingerprints computed on those machines and in CI are unchanged.
    for (const locale of ["en-US", "de-DE", "sv-SE"]) {
      expect(
        [...keys].sort((a, b) => a.localeCompare(b, locale)),
        locale,
      ).toEqual(ours);
    }
    // And it differs from the locales that were diverging, which is the point.
    for (const locale of ["lt-LT", "az-AZ"]) {
      expect(
        [...keys].sort((a, b) => a.localeCompare(b, locale)),
        locale,
      ).not.toEqual(ours);
    }
  });

  it("orders nested object keys too", () => {
    expect(stableStringify({ b: { missingCategory: 1, missingCategories: 2 }, a: 1 })).toBe(
      '{"a":1,"b":{"missingCategories":2,"missingCategory":1}}',
    );
  });
});
