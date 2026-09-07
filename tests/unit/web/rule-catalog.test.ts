import { describe, expect, it } from "vitest";
import {
  type CatalogRule,
  catalogRules,
  filterRules,
  parseRuleCategory,
  parseRuleSeverity,
  ruleCountsByCategory,
} from "../../../apps/web/lib/rule-catalog.js";
import { listRules } from "../../../src/core/rule-registry.js";
import { registerBuiltInRules } from "../../../src/rules/_index.js";

/**
 * `apps/web` cannot import the rule engine -- its workspace dependencies are the cloud packages
 * only, and pulling the registry in would drag the engine into the Next bundle. So the catalogue
 * is generated into JSON by `scripts/generate-rule-docs.mjs`, and this is what stops that copy
 * from drifting the way the docs array did before #673: it compares the shipped file against the
 * live registry, field by field.
 *
 * This test file is allowed to import both because it is a test, not a bundle.
 */

type RuleMeta = {
  id: string;
  title: string;
  description: string;
  rationale: string;
  defaultSeverity: string;
  category: string;
  appliesTo: readonly string[];
  configKeys: readonly string[];
};

function registryRules(): readonly RuleMeta[] {
  registerBuiltInRules();
  return listRules().map((entry) => (entry as unknown as { meta: RuleMeta }).meta);
}

describe("rule catalogue", () => {
  const registered = registryRules();

  it("ships every rule the engine registers", () => {
    const shipped = new Set(catalogRules.map((rule) => rule.id));
    const missing = registered.map((rule) => rule.id).filter((id) => !shipped.has(id));

    expect(
      missing,
      `These rules are registered but absent from apps/web/lib/rule-catalog.json. Run \`node scripts/generate-rule-docs.mjs\`:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("ships no rule the engine does not register", () => {
    const live = new Set(registered.map((rule) => rule.id));
    const stale = catalogRules.map((rule) => rule.id).filter((id) => !live.has(id));

    expect(stale, `The catalogue lists rules that no longer exist:\n${stale.join("\n")}`).toEqual([]);
  });

  it("agrees with the registry on what each rule is and how severe it is", () => {
    const byId = new Map(catalogRules.map((rule) => [rule.id, rule]));
    const disagreements: string[] = [];

    for (const rule of registered) {
      const shipped = byId.get(rule.id);
      if (!shipped) continue;
      if (shipped.defaultSeverity !== rule.defaultSeverity) {
        disagreements.push(
          `${rule.id} severity: catalogue ${shipped.defaultSeverity}, registry ${rule.defaultSeverity}`,
        );
      }
      if (shipped.category !== rule.category) {
        disagreements.push(`${rule.id} category: catalogue ${shipped.category}, registry ${rule.category}`);
      }
      if (shipped.description !== rule.description) disagreements.push(`${rule.id} description differs`);
      if (shipped.rationale !== rule.rationale) disagreements.push(`${rule.id} rationale differs`);
    }

    expect(disagreements, `The shipped catalogue disagrees with the registry:\n${disagreements.join("\n")}`).toEqual(
      [],
    );
  });
});

describe("filterRules", () => {
  const rule = (overrides: Partial<CatalogRule>): CatalogRule => ({
    id: "a.rule",
    title: "A rule",
    description: "Checks something.",
    rationale: "Because it matters.",
    defaultSeverity: "medium",
    category: "electrical",
    appliesTo: ["pcb"],
    configKeys: ["rules.a.rule.enabled"],
    tags: ["pcb"],
    evidenceType: "parsed",
    fixability: "manual",
    vendorDependence: "none",
    ...overrides,
  });

  it("orders by severity, so the list reads as what would block a release", () => {
    const ordered = filterRules({}, [
      rule({ id: "c", defaultSeverity: "info" }),
      rule({ id: "a", defaultSeverity: "high" }),
      rule({ id: "b", defaultSeverity: "critical" }),
    ]);

    expect(ordered.map((entry) => entry.id)).toEqual(["b", "a", "c"]);
  });

  it("breaks a severity tie on id, so the order is stable between renders", () => {
    const ordered = filterRules({}, [rule({ id: "z" }), rule({ id: "a" })]);
    expect(ordered.map((entry) => entry.id)).toEqual(["a", "z"]);
  });

  it("searches tags and config keys, not just the title", () => {
    // Someone arrives from a `boardreadyops.yml` they are reading, or from the word "rohs" in a
    // compliance conversation. Both should find the rule.
    const rules = [rule({ id: "bom.compliance", tags: ["rohs"], configKeys: ["rules.bom.compliance.enabled"] })];

    expect(filterRules({ query: "rohs" }, rules)).toHaveLength(1);
    expect(filterRules({ query: "rules.bom.compliance" }, rules)).toHaveLength(1);
    expect(filterRules({ query: "nothing-like-this" }, rules)).toHaveLength(0);
  });

  it("combines category and severity rather than treating them as alternatives", () => {
    const rules = [
      rule({ id: "a", category: "sourcing", defaultSeverity: "high" }),
      rule({ id: "b", category: "sourcing", defaultSeverity: "low" }),
      rule({ id: "c", category: "release", defaultSeverity: "high" }),
    ];

    expect(filterRules({ category: "sourcing", severity: "high" }, rules).map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("filter parsing", () => {
  it("accepts the values the catalogue actually uses", () => {
    expect(parseRuleCategory("sourcing")).toBe("sourcing");
    expect(parseRuleSeverity(" HIGH ")).toBe("high");
  });

  it("rejects anything else, so a hand-edited URL cannot filter to nothing", () => {
    expect(parseRuleCategory("'; drop table rules; --")).toBeUndefined();
    expect(parseRuleSeverity("catastrophic")).toBeUndefined();
    expect(parseRuleCategory(undefined)).toBeUndefined();
  });
});

describe("ruleCountsByCategory", () => {
  it("counts the shipped catalogue, so the filter labels state real numbers", () => {
    const counts = ruleCountsByCategory();
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);

    expect(total).toBe(catalogRules.length);
    expect(counts.get("manufacturability")).toBeGreaterThan(0);
  });
});
