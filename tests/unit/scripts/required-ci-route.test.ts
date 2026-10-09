import { describe, expect, it } from "vitest";
import { validateRequiredCiRoute } from "../../../scripts/required-ci-route.mjs";

const base = {
  check: "ci / coverage-gate",
  classifierResult: "success",
  needsWork: "true",
};

describe("required CI route is a real, fail-closed check", () => {
  it("requires heavy tests for a matching change", () => {
    expect(validateRequiredCiRoute(base)).toBe("required");
  });

  it("marks a reviewed, non-matching profile explicitly not applicable", () => {
    expect(validateRequiredCiRoute({ ...base, needsWork: "false" })).toBe("not-applicable");
  });

  it.each(["failure", "cancelled", "skipped", undefined])(
    "does not pass when risk classification is %s",
    (classifierResult) => {
      expect(() => validateRequiredCiRoute({ ...base, classifierResult })).toThrow(/classification did not succeed/u);
    },
  );

  it.each(["", "maybe", undefined])("rejects missing/invalid routing decision %s", (needsWork) => {
    expect(() => validateRequiredCiRoute({ ...base, needsWork })).toThrow(/invalid risk-profile decision/u);
  });

  it("requires the dependent build to succeed for dist verification", () => {
    for (const buildResult of ["failure", "skipped", "cancelled", undefined]) {
      expect(() =>
        validateRequiredCiRoute({
          ...base,
          check: "ci / verify-dist",
          buildResult,
        }),
      ).toThrow(/upstream build must succeed/u);
    }
    expect(
      validateRequiredCiRoute({
        ...base,
        check: "ci / verify-dist",
        buildResult: "success",
      }),
    ).toBe("required");
  });
});
