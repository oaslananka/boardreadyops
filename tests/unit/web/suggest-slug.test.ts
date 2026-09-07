import { describe, expect, it } from "vitest";
import { suggestSlug } from "../../../apps/web/components/projects/workspace-forms.js";

/**
 * The suggestion is only a first guess at a workspace slug -- the field stays editable and the
 * server unique-checks it either way -- but it has to produce something the `[a-z0-9-]+` pattern
 * on the input will accept, or the form rejects a value the user never typed.
 */
describe("suggestSlug", () => {
  it("lowercases and hyphenates a name", () => {
    expect(suggestSlug("Acme Hardware")).toBe("acme-hardware");
  });

  it("collapses runs of punctuation into one hyphen", () => {
    expect(suggestSlug("Acme  ---  Hardware & Co.")).toBe("acme-hardware-co");
  });

  it("trims the leading and trailing hyphen the collapse leaves behind", () => {
    // The collapse guarantees at most one at each end, which is why the trim needs no quantifier
    // -- and a quantifier here is what `typescript:S8786` flagged as backtracking.
    expect(suggestSlug("  Acme  ")).toBe("acme");
    expect(suggestSlug("!!!Acme!!!")).toBe("acme");
  });

  it("stays within the field's length limit", () => {
    expect(suggestSlug("a".repeat(200))).toHaveLength(64);
  });

  it.each([
    ["Acme Hardware", "acme-hardware"],
    ["Motor Control v2.1", "motor-control-v2-1"],
    ["Ünïcödé Board", "n-c-d-board"],
    ["  spaced  out  ", "spaced-out"],
  ])("turns %j into %j, which the input's own pattern accepts", (name, expected) => {
    // Asserted per case rather than looped with a conditional `expect`: a loop that skips the
    // empty result can pass without checking anything, which is the failure mode a test like
    // this is supposed to rule out.
    const slug = suggestSlug(name);
    expect(slug).toBe(expected);
    expect(slug).toMatch(/^[a-z0-9-]+$/u);
  });

  it("returns an empty string when nothing survives, rather than a bare hyphen", () => {
    // A bare "-" would pass the pattern and become a real, meaningless slug.
    expect(suggestSlug("!!!")).toBe("");
    expect(suggestSlug("")).toBe("");
  });
});
