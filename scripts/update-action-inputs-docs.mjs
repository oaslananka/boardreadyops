import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import * as yaml from "js-yaml";

export function renderActionDocs(document, action) {
  const inputRows = Object.entries(action.inputs ?? {})
    .map(([name, input]) => `| \`${name}\` | \`${input?.default ?? ""}\` | ${input?.description ?? ""} |`)
    .join("\n");
  const outputRows = Object.entries(action.outputs ?? {})
    .map(([name, output]) => `| \`${name}\` | ${output?.description ?? ""} |`)
    .join("\n");

  const withInputs = replaceSection(
    document,
    "## Inputs",
    "## Outputs",
    `## Inputs\n\n| Name | Default | Description |\n| --- | --- | --- |\n${inputRows}\n\n`,
  );
  return replaceSection(
    withInputs,
    "## Outputs",
    "## Pull request comments",
    `## Outputs\n\n| Name | Description |\n| --- | --- |\n${outputRows}\n\n`,
  );
}

export async function main(root = process.cwd()) {
  const action = yaml.load(await readFile(join(root, "action.yml"), "utf8"));
  const docsPath = join(root, "docs/action.md");
  const document = await readFile(docsPath, "utf8");
  await writeFile(docsPath, renderActionDocs(document, action), "utf8");
}

function replaceSection(document, startMarker, endMarker, replacement) {
  const start = document.indexOf(`${startMarker}\n`);
  const end = document.indexOf(`${endMarker}\n`, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`generated Action documentation marker not found: ${startMarker} -> ${endMarker}`);
  }
  return `${document.slice(0, start)}${replacement}${document.slice(end)}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
