import path from "node:path";
import { pathExists } from "../../util/fs.js";
import { globFiles } from "../../util/glob.js";
import { configuredSeverity, finding, rule, shouldRun } from "../helpers.js";

type RequirementLevel = "base" | "production";

interface CompletenessCategory {
  id: string;
  label: string;
  patterns: string[];
  level: RequirementLevel;
  found?: boolean;
}

const BASE_CATEGORIES: CompletenessCategory[] = [
  {
    id: "gerbers",
    label: "Gerber fabrication files",
    patterns: [
      "**/*.gbr",
      "**/*.gtl",
      "**/*.gbl",
      "**/*.gts",
      "**/*.gbs",
      "**/*.gto",
      "**/*.gbo",
      "**/*.gm*",
      "**/*.gko",
    ],
    level: "base",
  },
  {
    id: "drill",
    label: "Drill files",
    patterns: ["**/*.drl", "**/*.xln", "**/*.exc"],
    level: "base",
  },
  {
    id: "drill-report",
    label: "Drill report or map",
    patterns: ["**/*drill*report*", "**/*drill*map*", "**/*drill*.txt", "**/*drill*.pdf"],
    level: "base",
  },
  {
    id: "bom",
    label: "Bill of Materials",
    patterns: ["**/*bom*.csv", "**/*bill*of*materials*.csv", "**/assembly/bom.csv"],
    level: "base",
  },
  {
    id: "cpl",
    label: "Component placement list",
    patterns: [
      "**/*cpl*.csv",
      "**/*pos*.csv",
      "**/*position*.csv",
      "**/*positions*.csv",
      "**/*centroid*.csv",
      "**/assembly/positions.csv",
    ],
    level: "base",
  },
];

const PRODUCTION_CATEGORIES: CompletenessCategory[] = [
  {
    id: "fab-notes",
    label: "Fabrication notes",
    patterns: [],
    level: "production",
  },
  {
    id: "assembly-notes",
    label: "Assembly notes",
    patterns: ["**/assembly*notes*", "**/assembly/notes*", "**/docs/assembly*"],
    level: "production",
  },
  {
    id: "board-pdf",
    label: "Board PDF documentation",
    patterns: ["**/*board*.pdf", "**/*pcb*.pdf", "**/documentation/*.pdf"],
    level: "production",
  },
];

const FAB_NOTES_PATHS = ["fab/README.md", "manufacturing/notes.md", "docs/fab-notes.md"];

export const packageCompletenessRule = rule(
  {
    id: "manufacturing.package-completeness",
    title: "Release package is incomplete",
    description:
      "Validates that the release package includes all required manufacturing output categories. " +
      "Base categories (gerbers, drill, BOM, CPL) are required for every release. " +
      "Production categories (fab notes, assembly notes, board PDF) are required when releaseMode is production.",
    rationale:
      "An incomplete manufacturing package prevents hand-off to fabrication or assembly suppliers. " +
      "Structured completeness checks enable downstream tools and dashboards to track release readiness.",
    defaultSeverity: "high",
    appliesTo: ["pcb", "manifest"],
    configKeys: ["rules.manufacturing.package-completeness.severity"],
    kicadVersions: ["9", "10", "future"],
    tags: ["completeness", "fabrication", "manufacturing", "release"],
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.package-completeness")) {
      return [];
    }
    const isProduction = context.options.releaseMode === "production";
    const categories = [...BASE_CATEGORIES, ...(isProduction ? PRODUCTION_CATEGORIES : [])];

    const resolved = await resolveCategories(context.root, categories);
    const missing = resolved.filter((category) => !category.found);

    if (missing.length === 0) {
      return [];
    }

    const present = resolved.filter((category) => category.found);

    // Only report when at least one category is present — if nothing is present,
    // this is a project without any manufacturing outputs (let manufacturing.outputs-present handle that).
    if (present.length === 0 && !isProduction) {
      return [];
    }

    const completenessScore = Math.round((present.length / resolved.length) * 100);

    return missing.map((category) =>
      finding(context, {
        ruleId: "manufacturing.package-completeness",
        severity: configuredSeverity(context, "manufacturing.package-completeness", "high"),
        message: `Release package is missing ${category.label} (${category.id}).`,
        path: ".",
        kind: "manifest",
        details: {
          missingCategory: category.id,
          requirementLevel: category.level,
          completenessScore,
          presentCategories: present.map((c) => c.id),
          missingCategories: missing.map((c) => c.id),
        },
      }),
    );
  },
);

async function resolveCategories(
  root: string,
  categories: CompletenessCategory[],
): Promise<Array<CompletenessCategory & { found: boolean }>> {
  return Promise.all(
    categories.map(async (category) => {
      let found: boolean;
      if (category.id === "fab-notes") {
        found = await checkFabNotes(root);
      } else {
        const files = await globFiles(root, category.patterns);
        found = files.length > 0;
      }
      return { ...category, found };
    }),
  );
}

async function checkFabNotes(root: string): Promise<boolean> {
  for (const candidate of FAB_NOTES_PATHS) {
    if (await pathExists(path.resolve(root, candidate))) {
      return true;
    }
  }
  return false;
}
