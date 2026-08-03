import path from "node:path";
import { loadBom } from "../../bom/loader.js";
import type { ProjectContext, RuleContext } from "../../core/context.js";
import { readDesignFile } from "../../kicad/parsers/project-files.js";
import { activeVariantDnpRefs, parseVariants } from "../../kicad/variants.js";
import { configuredSeverity, finding, rule, shouldRun } from "../helpers.js";

export const variantConsistencyRule = rule(
  {
    id: "bom.variant-consistency",
    title: "Variant BOM contains a DNP override component",
    description: "Checks KiCad variant DNP overrides against each variant-specific BOM.",
    rationale: "Variant BOM drift can populate components that a selected hardware variant excludes.",
    defaultSeverity: "high",
    appliesTo: ["bom", "project"],
    configKeys: ["projects.variants", "rules.bom.variant-consistency.enabled"],
    kicadVersions: ["10", "future"],
    tags: ["bom", "variant", "kicad"],
  },
  async (context) => {
    if (!shouldRun(context, "bom.variant-consistency")) {
      return [];
    }
    const output = [];
    for (const project of context.projects) {
      output.push(...(await checkProjectVariants(context, project)));
    }
    return output;
  },
);

async function checkProjectVariants(context: RuleContext, project: ProjectContext) {
  const output = [];
  const projectConfig = context.config.projects?.find((candidate) => {
    const candidateRoot = path.resolve(context.root, candidate.path);
    const projectRoot = path.resolve(context.root, project.root);
    return candidateRoot === projectRoot;
  });
  let configuredVariants = (projectConfig?.variants ?? []).filter(
    (variant) => !context.options.variant || variant.name === context.options.variant,
  );
  if (
    configuredVariants.length === 0 &&
    context.options.variant &&
    context.options.bom &&
    context.options.bom !== "auto"
  ) {
    configuredVariants = [{ name: context.options.variant, bom: context.options.bom }];
  }
  if (configuredVariants.length === 0) {
    return [];
  }
  const parsedVariants = parseVariants((await readDesignFile(path.resolve(context.root, project.projectFile))) ?? "");
  for (const configuredVariant of configuredVariants) {
    const parsedVariant = parsedVariants.find((variant) => variant.name === configuredVariant.name);
    if (!parsedVariant || !configuredVariant.bom) {
      continue;
    }
    const rows = await loadBom(path.resolve(context.root, configuredVariant.bom));
    const activeDnp = new Set(
      activeVariantDnpRefs(
        parsedVariant,
        rows.map((row) => row.reference),
      ),
    );
    for (const row of rows) {
      if (!row.dnp && activeDnp.has(row.reference)) {
        output.push(
          finding(context, {
            ruleId: "bom.variant-consistency",
            severity: configuredSeverity(context, "bom.variant-consistency", "high"),
            message: `${row.reference} is DNP in variant ${configuredVariant.name} but appears populated in its BOM.`,
            path: row.sourcePath,
            kind: "bom",
            line: row.line,
            details: { variant: configuredVariant.name, reference: row.reference },
          }),
        );
      }
    }
  }
  return output;
}
