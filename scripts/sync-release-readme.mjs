import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const VERSION_PATTERN = "[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?";

export const PUBLIC_RELEASE_PATHS = [
  "README.md",
  "docs/install.md",
  "docs/action.md",
  "docs/security/release-integrity.md",
  "docs/repo-maturity-report.md",
  "docs/release/reference-synchronization.md",
  "docs/release/copy-paste-audit.md",
  "docs/release/channel-verification.md",
];

export const IMMUTABLE_ACTION_PIN_PATHS = [
  "README.md",
  "docs/action.md",
  "docs/github-action.md",
  "docs/integrations/kibot.md",
  "docs/sbom.md",
  "docs/review-app.md",
];

const VERSION_NEUTRAL_PATHS = [".github/ISSUE_TEMPLATE/bug_report.yml"];
const PUBLIC_SURFACE_PATHS = [
  ...new Set([...PUBLIC_RELEASE_PATHS, ...IMMUTABLE_ACTION_PIN_PATHS, ...VERSION_NEUTRAL_PATHS]),
];

export function syncReleaseReadme(readme, version) {
  assertReleaseVersion(version);

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

export function syncPublicReleaseFiles(files, version) {
  assertReleaseVersion(version);
  const next = { ...files };

  for (const path of PUBLIC_RELEASE_PATHS) {
    const content = files[path];
    if (typeof content !== "string") {
      throw new Error(`public release surface missing: ${path}`);
    }
    next[path] = syncPublicReleaseFile(path, content, version);
  }

  return next;
}

export function verifyPublicReleaseFiles(files, version) {
  const synchronized = syncPublicReleaseFiles(files, version);
  const drift = PUBLIC_RELEASE_PATHS.filter((path) => synchronized[path] !== files[path]);
  if (drift.length > 0) {
    throw new Error(
      `public release reference drift: ${drift.join(", ")}; run \`corepack pnpm run release:readme\` and review the diff`,
    );
  }

  const pinGroups = [];
  for (const path of IMMUTABLE_ACTION_PIN_PATHS) {
    const content = files[path];
    if (typeof content !== "string") throw new Error(`public release surface missing: ${path}`);
    const pins = [
      ...content.matchAll(
        /oaslananka\/boardreadyops(?:\/apps\/container)?@([0-9a-f]{40})\s+#\s+v([0-9]+\.[0-9]+\.[0-9]+)/g,
      ),
    ];
    if (pins.length === 0) throw new Error(`immutable Action pin missing: ${path}`);
    for (const pin of pins) pinGroups.push({ path, sha: pin[1], version: pin[2] });
  }
  const uniquePins = new Set(pinGroups.map((pin) => `${pin.sha}@${pin.version}`));
  if (uniquePins.size !== 1) {
    throw new Error(
      `immutable Action pin drift: ${pinGroups.map((pin) => `${pin.path}=${pin.sha}#v${pin.version}`).join(", ")}`,
    );
  }

  const bugTemplate = files[".github/ISSUE_TEMPLATE/bug_report.yml"];
  if (typeof bugTemplate !== "string") {
    throw new Error("public release surface missing: .github/ISSUE_TEMPLATE/bug_report.yml");
  }
  if (/placeholder:\s*v?[0-9]+\.[0-9]+\.[0-9]+/.test(bugTemplate)) {
    throw new Error("bug-report version placeholder must be version-neutral");
  }
}

export async function main(root = process.cwd(), args = process.argv.slice(2)) {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const files = Object.fromEntries(
    await Promise.all(PUBLIC_SURFACE_PATHS.map(async (path) => [path, await readFile(join(root, path), "utf8")])),
  );

  if (args.includes("--check")) {
    verifyPublicReleaseFiles(files, packageJson.version);
    return;
  }

  const synchronized = syncPublicReleaseFiles(files, packageJson.version);
  await Promise.all(
    PUBLIC_RELEASE_PATHS.filter((path) => synchronized[path] !== files[path]).map((path) =>
      writeFile(join(root, path), synchronized[path]),
    ),
  );
}

function syncPublicReleaseFile(path, content, version) {
  switch (path) {
    case "README.md":
      return syncReleaseReadme(content, version);
    case "docs/install.md":
      return replaceReleaseTokens(content, version);
    case "docs/action.md":
      return replaceExactlyOnce(
        content,
        new RegExp(`(The public\\s+)\`v${VERSION_PATTERN}\` tag`),
        (_match, prefix) => `${prefix}\`v${version}\` tag`,
        "Action public release tag",
      );
    case "docs/security/release-integrity.md":
      return replaceExactlyOnce(
        content,
        new RegExp(`/releases/download/v${VERSION_PATTERN}/SHA256SUMS`),
        `/releases/download/v${version}/SHA256SUMS`,
        "release integrity checksum URL",
      );
    case "docs/repo-maturity-report.md":
      return replaceExactlyOnce(
        content,
        new RegExp(`Latest release \`v${VERSION_PATTERN}\` has binary assets`),
        `Latest release \`v${version}\` has binary assets`,
        "maturity release status",
      );
    case "docs/release/reference-synchronization.md":
    case "docs/release/copy-paste-audit.md":
      return replaceSupersessionTokens(content, version);
    case "docs/release/channel-verification.md":
      return replaceChannelTokens(content, version);
    default:
      throw new Error(`unsupported public release surface: ${path}`);
  }
}

function replaceReleaseTokens(input, version) {
  return input
    .replace(new RegExp(`boardreadyops@${VERSION_PATTERN}`, "g"), `boardreadyops@${version}`)
    .replace(new RegExp(`\`v${VERSION_PATTERN}\``, "g"), `\`v${version}\``)
    .replace(new RegExp(`BOARDREADYOPS_VERSION=${VERSION_PATTERN}`, "g"), `BOARDREADYOPS_VERSION=${version}`);
}

function replaceSupersessionTokens(input, version) {
  const boundary = /^## Audit Target$/m.exec(input);
  if (!boundary) {
    throw new Error("public release historical boundary not found");
  }
  let current = input.slice(0, boundary.index);
  const historical = input.slice(boundary.index);
  current = current.replace(new RegExp(`boardreadyops@${VERSION_PATTERN}`, "g"), `boardreadyops@${version}`);
  current = current.replace(
    new RegExp(`(GitHub Release)(\\s+)\`v${VERSION_PATTERN}\``),
    (_match, prefix, whitespace) => `${prefix}${whitespace}\`v${version}\``,
  );
  return `${current}${historical}`;
}

function replaceChannelTokens(input, version) {
  const boundary = /^## (?:Verified Public Snapshot|Historical Audit Target)/m.exec(input);
  if (!boundary) {
    throw new Error("public release historical boundary not found");
  }
  let current = input.slice(0, boundary.index);
  const historical = input.slice(boundary.index);
  current = current.replace(new RegExp(`boardreadyops@${VERSION_PATTERN}`, "g"), `boardreadyops@${version}`);
  current = current.replace(
    new RegExp(`the \`v${VERSION_PATTERN}\` GitHub Release`),
    `the \`v${version}\` GitHub Release`,
  );
  current = current.replace(
    new RegExp(`\\| Public release \\| \`v${VERSION_PATTERN}\` \\|`),
    `| Public release | \`v${version}\` |`,
  );
  current = current.replace(
    new RegExp(`GHCR \`v${VERSION_PATTERN}\`/\`v1\`/\`latest\``, "g"),
    `GHCR \`v${version}\`/\`v1\`/\`latest\``,
  );
  current = current.replace(
    new RegExp(`\\| Container aliases \\| \`v${VERSION_PATTERN}\`, \`v1\`, and \`latest\` \\|`),
    `| Container aliases | \`v${version}\`, \`v1\`, and \`latest\` |`,
  );
  return `${current}${historical}`;
}

function assertReleaseVersion(version) {
  if (!new RegExp(`^${VERSION_PATTERN}$`).test(version)) {
    throw new Error(`invalid release version: ${version}`);
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

  const rendered = typeof replacement === "function" ? replacement(first[0], ...first.slice(1)) : replacement;
  return `${input.slice(0, first.index)}${rendered}${input.slice(first.index + first[0].length)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
