import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const VERSION_PATTERN = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;

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
  return replaceExactlyOnce(
    readme,
    /(?:The current public npm package is|\*\*Repository-prepared version:\*\*)[\s\S]*?(?=\n\n## Runtime Support)/u,
    `**Repository-prepared version:** \`boardreadyops@${version}\`. This is the package version
in this source revision, **not evidence that it has been published**.
Check [npm](https://www.npmjs.com/package/boardreadyops) and
[GitHub Releases](https://github.com/oaslananka/boardreadyops/releases) for the
latest publicly available version. Verify the selected release's binaries,
\`SHA256SUMS\`, SBOM, and runtime compatibility before installation. See
[release channel verification](docs/release/channel-verification.md)
for historical verified snapshots and outstanding follow-ups.`,
    "repository-prepared version",
  );
}

export function syncPublicReleaseFiles(files, version) {
  assertReleaseVersion(version);
  const next = { ...files };

  for (const path of PUBLIC_RELEASE_PATHS) {
    const content = files[path];
    if (typeof content !== "string") {
      throw new TypeError(`public release surface missing: ${path}`);
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
    if (typeof content !== "string") throw new TypeError(`public release surface missing: ${path}`);
    const pins = [
      ...content.matchAll(/oaslananka\/boardreadyops(?:\/apps\/container)?@([0-9a-f]{40})\s+#\s+v(\d+\.\d+\.\d+)/g),
    ];
    if (pins.length === 0) throw new Error(`immutable Action pin missing: ${path}`);
    for (const pin of pins) pinGroups.push({ path, sha: pin[1], version: pin[2] });
  }
  const uniquePins = new Set(pinGroups.map((pin) => `${pin.sha}@${pin.version}`));
  if (uniquePins.size !== 1) {
    const formatted = pinGroups.map((pin) => `${pin.path}=${pin.sha}#v${pin.version}`).join(", ");
    throw new Error(`immutable Action pin drift: ${formatted}`);
  }

  const bugTemplate = files[".github/ISSUE_TEMPLATE/bug_report.yml"];
  if (typeof bugTemplate !== "string") {
    throw new TypeError("public release surface missing: .github/ISSUE_TEMPLATE/bug_report.yml");
  }
  if (/placeholder:\s*v?\d+\.\d+\.\d+/.test(bugTemplate)) {
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
      return syncInstallDocs(content, version);
    case "docs/action.md":
      return replaceExactlyOnce(
        content,
        /This example pins the reviewed release commit shown above\.[\s\S]*?(?=\n\n## Inputs)|This example pins a reviewed, immutable Action commit\.[\s\S]*?(?=\n\n## Inputs)/u,
        `This example pins a reviewed, immutable Action commit. Find the latest
**published** version in [GitHub Releases](https://github.com/oaslananka/boardreadyops/releases);
the version prepared in a release pull request may not be available yet. The
floating \`v1\` alias moves with stable releases.`,
        "Action published-release guidance",
      );
    case "docs/security/release-integrity.md":
      return replaceExactlyOnce(
        content,
        /curl -fsSLO https:\/\/github\.com\/oaslananka\/boardreadyops\/releases\/(?:download\/v[\d.]+|latest\/download)\/SHA256SUMS/u,
        "curl -fsSLO https://github.com/oaslananka/boardreadyops/releases/latest/download/SHA256SUMS",
        "latest published checksum URL",
      );
    case "docs/repo-maturity-report.md":
      return replaceExactlyOnce(
        content,
        /\| GitHub Releases \| Passed \|[^\n]* \|/u,
        "| GitHub Releases | Passed | Check [published GitHub Releases](https://github.com/oaslananka/boardreadyops/releases) for actual binary assets, `SHA256SUMS` and SBOM; a prepared source version is not publication evidence. |",
        "maturity release status",
      );
    case "docs/release/reference-synchronization.md":
    case "docs/release/copy-paste-audit.md":
      return replaceExactlyOnce(
        content,
        /## Current Supersession \(2026-06-19\)[\s\S]*?(?=\n\n## Audit Target)/u,
        `## Current Supersession (2026-06-19)

This page records historical audit evidence below. The repository-prepared
package version is \`boardreadyops@${version}\`; it may not be published.
Consult [npm](https://www.npmjs.com/package/boardreadyops) and
[GitHub Releases](https://github.com/oaslananka/boardreadyops/releases) for
actual public availability, and [Release Channel Verification](channel-verification.md)
for dated acceptance evidence. Do not treat the historical \`v1.0.2\` results as
the current release status.`,
        "historical audit supersession",
      );
    case "docs/release/channel-verification.md":
      return replaceExactlyOnce(
        content,
        /(?:> \*\*Current status:\*\*|> \*\*Source candidate:\*\*)[\s\S]*?(?=\n\n## Verified Public Snapshot)/u,
        `> **Source candidate:** \`boardreadyops@${version}\` (\`v${version}\`) is prepared
> in this repository revision, **not necessarily published**. Check
> [npm](https://www.npmjs.com/package/boardreadyops) and
> [GitHub Releases](https://github.com/oaslananka/boardreadyops/releases)
> for the latest actual release. Verify tag, floating aliases, checksums, SBOM,
> and image digests independently before recording public acceptance.

## Current Release Contract

| Surface | Current contract |
| --- | --- |
| Prepared source candidate | \`v${version}\` (not publication evidence) |
| Public release | Check [GitHub Releases](https://github.com/oaslananka/boardreadyops/releases) |
| npm package | Check the registry's actual \`latest\` dist-tag |
| Binary assets | Confirm platform binaries, \`SHA256SUMS\`, and \`sbom.cyclonedx.json\` on the published tag |
| Root Action | Pin a reviewed release commit SHA for reproducibility; \`v1\` can move |
| Container Action | Pin the same reviewed release commit SHA and verify image digest |
| Container aliases | Confirm actual published \`v1\`/\`latest\` digests independently |
| Homebrew formula | \`Formula/boardreadyops.rb\` is independently versioned; check the formula's tag and checksums before use |

Run the deterministic repository freshness check on every change:

\`\`\`bash
corepack pnpm run verify:public-surface
\`\`\`

For a live public-channel audit **after publication**, run:

\`\`\`bash
BOARDREADY_VERIFY_PUBLIC_CHANNELS=1 corepack pnpm run verify:release-channels
\`\`\``,
        "candidate and actual public release distinction",
      );
    default:
      throw new Error(`unsupported public release surface: ${path}`);
  }
}

function syncInstallDocs(content, version) {
  let next = replaceExactlyOnce(
    content,
    /(?:The current public npm package is|\*\*Repository-prepared version:\*\*)[\s\S]*?(?=\n\n## Binary Installers)/u,
    `**Repository-prepared version:** \`boardreadyops@${version}\` reflects this checkout's
source candidate, **not proof of npm publication**. Confirm the current public
version at [npm](https://www.npmjs.com/package/boardreadyops). For a one-off
install of the latest published version:

\`\`\`bash
npx -y boardreadyops@latest --help
\`\`\`

For release-critical CI, resolve and pin the exact version you verified
instead of relying on a moving \`latest\` tag.`,
    "npm prepared-versus-published install guidance",
  );

  next = replaceExactlyOnce(
    next,
    /## Binary Installers[\s\S]*?(?=\n\n## Verification Status)/u,
    `## Binary Installers

The shell and PowerShell installers require an actual
[GitHub Release](https://github.com/oaslananka/boardreadyops/releases) with
platform binary assets and matching \`SHA256SUMS\`. A version prepared in a
release PR may not exist yet.

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/oaslananka/boardreadyops/main/install.sh | sh
\`\`\`

\`\`\`powershell
irm https://raw.githubusercontent.com/oaslananka/boardreadyops/main/install.ps1 | iex
\`\`\`

To pin a published release, set \`BOARDREADYOPS_VERSION\` to the version
confirmed on GitHub Releases. Never infer published assets from the repository's
prepared package version.

## Homebrew

\`Formula/boardreadyops.rb\` is a separately maintained formula and may lag
both source and published releases. Verify its embedded version and checksums
against the selected published tag before using or copying it into a tap.`,
    "binary installer and Homebrew publication guidance",
  );
  return next;
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
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
