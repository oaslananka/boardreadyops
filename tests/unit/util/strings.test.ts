import { describe, expect, it } from "vitest";
import { compareCodePoints } from "../../../src/util/strings.js";

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
