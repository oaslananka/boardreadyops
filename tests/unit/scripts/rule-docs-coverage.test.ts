import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listRules } from "../../../src/core/rule-registry.js";
import { registerBuiltInRules } from "../../../src/rules/_index.js";

/**
 * The published rule reference is generated, and it used to be generated from a hand-maintained
 * array inside `scripts/generate-rule-docs.mjs`. That array drifted: four registered rules --
 * `bom.unknown-lifecycle` and the three `manufacturing.dfm-*` checks -- were never added to it,
 * so the documentation did not mention checks the product performs, and nothing could notice
 * because the array was the only source anyone compared against.
 *
 * The generator now reads the registry, and this asserts the outcome from the other side: every
 * rule the engine runs has a page, and the index links to it. A rule added without regenerating
 * fails here rather than shipping undocumented.
 */

const rulesDirectory = path.join(process.cwd(), "docs", "rules");

function registeredRuleIds(): readonly string[] {
  registerBuiltInRules();
  return listRules()
    .map((entry) => (entry as unknown as { meta: { id: string } }).meta.id)
    .sort();
}

describe("generated rule documentation", () => {
  const ids = registeredRuleIds();

  it("covers a plausible number of rules, so an empty registry cannot pass this file", () => {
    expect(ids.length).toBeGreaterThanOrEqual(44);
  });

  it("gives every registered rule a page", () => {
    const missing = ids.filter((id) => !existsSync(path.join(rulesDirectory, `${id}.md`)));

    expect(
      missing,
      `These rules are registered but have no generated page. Run \`node scripts/generate-rule-docs.mjs\`:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("links every registered rule from the index", () => {
    const index = readFileSync(path.join(rulesDirectory, "index.md"), "utf8");
    const unlinked = ids.filter((id) => !index.includes(`(${id}.md)`));

    expect(
      unlinked,
      `These rules have a page but the index does not link it, so nobody browsing the docs finds them:\n${unlinked.join("\n")}`,
    ).toEqual([]);
  });

  it("states each rule's real default severity rather than a copy that can drift", () => {
    registerBuiltInRules();
    const severities = new Map(
      listRules().map((entry) => {
        const meta = (entry as unknown as { meta: { id: string; defaultSeverity: string } }).meta;
        return [meta.id, meta.defaultSeverity];
      }),
    );

    const wrong: string[] = [];
    for (const id of ids) {
      const page = readFileSync(path.join(rulesDirectory, `${id}.md`), "utf8");
      const expected = severities.get(id);
      if (expected && !page.includes(`severity: ${expected}`)) wrong.push(`${id} (expected ${expected})`);
    }

    expect(wrong, `Generated pages disagree with the registry about severity:\n${wrong.join("\n")}`).toEqual([]);
  });
});
