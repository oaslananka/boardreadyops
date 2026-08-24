import { describe, expect, it } from "vitest";
import { requiredEnvironmentValue } from "../../../scripts/lib/environment.mjs";

describe("environment helpers", () => {
  it("throws TypeError when a required environment value is not a string", () => {
    expect(() => requiredEnvironmentValue({ TOKEN: 42 }, "TOKEN")).toThrowError(TypeError);
    expect(() => requiredEnvironmentValue({ TOKEN: 42 }, "TOKEN")).toThrowError("TOKEN is required");
  });
});
