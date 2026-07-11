import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const VERSION_PATTERN = "[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?";

export function syncReleaseReadme(readme, version) {
  if (!new RegExp(`^${VERSION_PATTERN}$`).test(version)) {
    throw new Error(`invalid release version: ${version}`);
  }

  let next = readme;
  next = replaceExactlyOnce(
    next,
    new RegExp(`The current public npm package is \`boardreadyops@${VERSION_PATTERN}\``),
    `The current public npm package is \`boardreadyops@${version}\``,
    "current npm package",
  );
  next = replaceExactlyOnce(
    next,
    new RegExp(`matches the public \`v${VERSION_PATTERN}\` tag archive`),
    `matches the public \`v${version}\` tag archive`,
    "public tag archive",
  );
  next = replaceExactlyOnce(
    next,
    new RegExp(`Binary release assets should be verified against \`v${VERSION_PATTERN}\``),
    `Binary release assets should be verified against \`v${version}\``,
    "binary release tag",
  );

  return next;
}

export async function main(root = process.cwd()) {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const readmePath = join(root, "README.md");
  const readme = await readFile(readmePath, "utf8");
  const next = syncReleaseReadme(readme, packageJson.version);

  if (next !== readme) {
    await writeFile(readmePath, next);
  }
}

function replaceExactlyOnce(input, pattern, replacement, label) {
  const first = pattern.exec(input);
  if (!first) {
    throw new Error(`README release marker not found: ${label}`);
  }

  const remainder = input.slice(first.index + first[0].length);
  if (pattern.test(remainder)) {
    throw new Error(`README release marker is ambiguous: ${label}`);
  }

  return `${input.slice(0, first.index)}${replacement}${input.slice(first.index + first[0].length)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
