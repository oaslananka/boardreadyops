import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

/**
 * Rule pages are generated from the rule registry the engine actually runs, not from a copy.
 *
 * They used to be generated from a hand-maintained array here, and it drifted: four registered
 * rules -- `bom.unknown-lifecycle` and the three `manufacturing.dfm-*` checks -- were never added
 * to it, so `docs/rules.md` and the published rule pages simply did not mention checks the
 * product performs. Nothing could notice, because the array was the only source.
 *
 * Now the facts come from the registry and only the prose lives here. A registered rule with no
 * prose fails this script rather than being quietly skipped, which is the property the old shape
 * could not have.
 */

/**
 * What a rule's own metadata cannot carry: the precise firing condition and the shape of the
 * `details` object in a JSON finding. Keyed by rule id.
 *
 * Held in `rule-narratives.json` rather than inline. Forty-four entries of the same two fields is
 * data, not code, and as an object literal here it was 192 lines that a duplication analyser reads
 * -- correctly -- as the same block repeated. Adding one rule's prose then counted the surrounding
 * table as newly duplicated code. A data file is also the honest home for it: nothing in it runs.
 */
const narratives = createRequire(import.meta.url)("./rule-narratives.json");

/** Bundles the registry so this plain-Node script can read the TypeScript source of truth. */
async function loadRegisteredRules() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-rule-docs-"));
  const outfile = path.join(directory, "registry.cjs");
  try {
    await build({
      entryPoints: ["scripts/rule-registry-entry.mjs"],
      outfile,
      bundle: true,
      platform: "node",
      target: "node24",
      format: "cjs",
      logLevel: "silent",
    });
    const require = createRequire(import.meta.url);
    const { registerBuiltInRules, listRules } = require(outfile);
    registerBuiltInRules();
    return listRules().map((entry) => entry.meta);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const registered = await loadRegisteredRules();

const undocumented = registered.filter((rule) => !narratives[rule.id]).map((rule) => rule.id);
if (undocumented.length > 0) {
  throw new Error(
    `these rules are registered but have no documentation prose in scripts/generate-rule-docs.mjs:\n  ${undocumented.join("\n  ")}\n` +
      "Add a `fires` and `details` entry for each. Generated pages must cover every rule the engine runs.",
  );
}

const orphaned = Object.keys(narratives).filter((id) => !registered.some((rule) => rule.id === id));
if (orphaned.length > 0) {
  throw new Error(
    `these rules have documentation prose but are not registered:\n  ${orphaned.join("\n  ")}\n` +
      "Remove the entry, or register the rule.",
  );
}

// `checks` is the rule's own description -- the registry already states what it checks, so
// restating it here is what let the two disagree.
const rules = registered
  .map((rule) => ({
    id: rule.id,
    severity: rule.defaultSeverity,
    appliesTo: rule.appliesTo,
    configKeys: rule.configKeys,
    checks: rule.description,
    fires: narratives[rule.id].fires,
    details: narratives[rule.id].details,
  }))
  .sort((left, right) => left.id.localeCompare(right.id));

const groups = new Map();
for (const item of rules) {
  const group = item.id.split(".")[0];
  if (!groups.has(group)) {
    groups.set(group, []);
  }
  groups.get(group).push(item);
}

await mkdir("docs/rules", { recursive: true });
await writeFile(
  "docs/rules/index.md",
  `# Rules

BoardReadyOps rules use stable \`group.rule\` identifiers. Each rule page records the default severity, applicable input type, configuration keys, details shape, and reporting context.

${rules.map((rule) => `- [${rule.id}](${rule.id}.md)`).join("\n")}
`,
  "utf8",
);

for (const [group, items] of groups) {
  await writeFile(
    `docs/rules/${group}.md`,
    `# ${title(group)} Rules

${items.map((rule) => `- [${rule.id}](${rule.id}.md): ${rule.checks}`).join("\n")}
`,
    "utf8",
  );
}

for (const rule of rules) {
  await writeFile(`docs/rules/${rule.id}.md`, renderRule(rule), "utf8");
}

// The same registry, in the shape a page can render.
//
// `apps/web` does not depend on the rule engine -- its workspace dependencies are the cloud
// packages only -- so importing the registry there would pull the whole engine into the Next
// bundle and cross a boundary the workspace deliberately does not declare. A generated file is
// the bridge, and generating it here rather than in a second script keeps one source and one
// run: the markdown and the catalogue can never describe different rule sets.
//
// `rule-catalog.test.ts` fails when this file and the registry disagree.
await writeFile(
  "apps/web/lib/rule-catalog.json",
  `${JSON.stringify(
    {
      generatedBy: "scripts/generate-rule-docs.mjs",
      rules: registered
        .map((rule) => ({
          id: rule.id,
          title: rule.title,
          description: rule.description,
          rationale: rule.rationale,
          defaultSeverity: rule.defaultSeverity,
          category: rule.category,
          appliesTo: rule.appliesTo,
          configKeys: rule.configKeys,
          tags: rule.tags,
          evidenceType: rule.evidenceType,
          fixability: rule.fixability,
          vendorDependence: rule.vendorDependence,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

function renderRule(rule) {
  return `---
id: ${rule.id}
severity-default: ${rule.severity}
applies-to:
${rule.appliesTo.map((entry) => `  - ${entry}`).join("\n")}
config-keys:
${rule.configKeys.map((entry) => `  - ${entry}`).join("\n")}
---

# ${rule.id}

## What It Checks

${rule.checks}

## When It Fires

${rule.fires}

## Configuration Example

\`\`\`yaml
version: 1
rules:
  ${rule.id}:
    enabled: true
    severity: ${rule.severity}
\`\`\`

## JSON Finding Details Shape

\`\`\`text
${rule.details}
\`\`\`

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
`;
}

function title(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
