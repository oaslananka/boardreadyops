import { describe, expect, it } from "vitest";

import {
  syncPublicReleaseFiles,
  syncReleaseReadme,
  verifyPublicReleaseFiles,
} from "../../../scripts/sync-release-readme.mjs";

const actionPin = "005afb83bd04f50a8da33bbffc441818910951f6";

const readme = `
The current public npm package is \`boardreadyops@1.7.2\`. It is verified on
Node.js 22.14+ and 24, includes the current CLI bundle, schemas, docs, Action
metadata, and matches the public \`v1.7.2\` tag archive.
Binary release assets should be verified against \`v1.7.2\`, which publishes the
current release assets.

- uses: oaslananka/boardreadyops@${actionPin} # v1.7.2
`;

const publicFiles = {
  "README.md": readme,
  "docs/install.md": `
The current public npm package is \`boardreadyops@1.4.6\`.
\`\`\`bash
npx -y boardreadyops@1.4.6 --help
\`\`\`
The \`v1.4.6\` release contains the platform binary matrix.
Pin a specific release with \`BOARDREADYOPS_VERSION=1.4.6\`.
The Homebrew formula is populated with the \`v1.4.6\` checksums.
It points at \`v1.4.6\` release binaries.
`,
  "docs/action.md": `The public \`v1.3.0\` tag remains smoke-tested.\n- uses: oaslananka/boardreadyops@${actionPin} # v1.7.2\n`,
  "docs/github-action.md": `- uses: oaslananka/boardreadyops/apps/container@${actionPin} # v1.7.2\n`,
  "docs/integrations/kibot.md": `uses: oaslananka/boardreadyops@${actionPin} # v1.7.2\n`,
  "docs/sbom.md": `- uses: oaslananka/boardreadyops@${actionPin} # v1.7.2\n`,
  "docs/review-app.md": `- uses: oaslananka/boardreadyops@${actionPin} # v1.7.2\n`,
  ".github/ISSUE_TEMPLATE/bug_report.yml": "placeholder: Paste the exact --version output\n",
  "docs/security/release-integrity.md":
    "curl -fsSLO https://github.com/oaslananka/boardreadyops/releases/download/v1.7.2/SHA256SUMS\n",
  "docs/repo-maturity-report.md":
    "| GitHub Releases | Passed | Latest release `v1.7.2` has binary assets, `SHA256SUMS`, and SBOM. |\n",
  "docs/release/reference-synchronization.md": `
## Current Supersession (2026-06-19)
The current public channel state is superseded by \`boardreadyops@1.4.6\` and GitHub Release \`v1.4.6\`.
Keep the historical \`v1.0.2\` rows below for traceability.

## Audit Target
| Package version | \`1.0.2\` |
| Public release reference | \`v1.0.2\` |
`,
  "docs/release/copy-paste-audit.md": `
## Current Supersession (2026-06-19)
The current public channel state is superseded by \`boardreadyops@1.4.6\` and GitHub Release \`v1.4.6\`.
Keep the historical \`v1.0.2\` rows below for traceability.

## Audit Target
| Package version | \`1.0.2\` |
`,
  "docs/release/channel-verification.md": `
> **Current status:** The latest public release is \`boardreadyops@1.12.0\` on npm and the \`v1.12.0\` GitHub Release. The historical \`v1.1.0\` audit remains below.

## Current Release Contract
| Public release | \`v1.12.0\` |
| npm package | \`boardreadyops@1.12.0\` (\`latest\`) |
| Container aliases | \`v1.12.0\`, \`v1\`, and \`latest\` |

## Verified Public Snapshot — v1.12.0 (2026-07-13)
The exact \`v1.12.0\` audit remains immutable evidence.
`,
};

describe("sync-release-readme", () => {
  it("updates public release channel references without changing immutable Action pins", () => {
    const result = syncReleaseReadme(readme, "1.8.0");

    expect(result).toContain("boardreadyops@1.8.0");
    expect(result).toContain("public `v1.8.0` tag archive");
    expect(result).toContain("verified against `v1.8.0`");
    expect(result).toContain(`oaslananka/boardreadyops@${actionPin} # v1.7.2`);
  });

  it("synchronizes current public surfaces while preserving historical snapshots and immutable Action pins", () => {
    const result = syncPublicReleaseFiles(publicFiles, "1.30.1");

    expect(result["README.md"]).toContain("boardreadyops@1.30.1");
    expect(result["README.md"]).toContain(`oaslananka/boardreadyops@${actionPin} # v1.7.2`);
    expect(result["docs/install.md"]).toContain("npx -y boardreadyops@1.30.1 --help");
    expect(result["docs/install.md"]).toContain("BOARDREADYOPS_VERSION=1.30.1");
    expect(result["docs/action.md"]).toContain("public `v1.30.1` tag");
    expect(result["docs/security/release-integrity.md"]).toContain("/releases/download/v1.30.1/SHA256SUMS");
    expect(result["docs/repo-maturity-report.md"]).toContain("Latest release `v1.30.1`");
    expect(result["docs/release/reference-synchronization.md"]).toContain("boardreadyops@1.30.1");
    expect(result["docs/release/reference-synchronization.md"]).toContain("historical `v1.0.2` rows");
    expect(result["docs/release/reference-synchronization.md"]).toContain("| Package version | `1.0.2` |");
    expect(result["docs/release/copy-paste-audit.md"]).toContain("historical `v1.0.2` rows");
    expect(result["docs/release/copy-paste-audit.md"]).toContain("| Package version | `1.0.2` |");
    expect(result["docs/release/channel-verification.md"]).toContain("boardreadyops@1.30.1");
    expect(result["docs/release/channel-verification.md"]).toContain("historical `v1.1.0` audit");
    expect(result["docs/release/channel-verification.md"]).toContain(
      "## Verified Public Snapshot — v1.12.0 (2026-07-13)",
    );
  });

  it("rejects inconsistent immutable Action pins and hard-coded bug-report placeholders", () => {
    const synchronized = syncPublicReleaseFiles(publicFiles, "1.30.1");
    const stale = {
      ...synchronized,
      "docs/sbom.md": "- uses: oaslananka/boardreadyops@1111111111111111111111111111111111111111 # v1.4.6\n",
      ".github/ISSUE_TEMPLATE/bug_report.yml": "placeholder: 1.7.2\n",
    };

    expect(() => verifyPublicReleaseFiles(stale, "1.30.1")).toThrow(/immutable Action pin drift|version-neutral/);
  });

  it("reports actionable public-surface drift", () => {
    expect(() => verifyPublicReleaseFiles(publicFiles, "1.30.1")).toThrow(
      /public release reference drift.*release:readme/s,
    );

    const synchronized = syncPublicReleaseFiles(publicFiles, "1.30.1");
    expect(() => verifyPublicReleaseFiles(synchronized, "1.30.1")).not.toThrow();
  });

  it("fails closed when a required README release marker is missing", () => {
    expect(() => syncReleaseReadme("# BoardReadyOps\n", "1.8.0")).toThrow("README release marker not found");
  });

  it("rejects malformed release versions", () => {
    expect(() => syncReleaseReadme(readme, "latest")).toThrow("invalid release version");
    expect(() => syncPublicReleaseFiles(publicFiles, "latest")).toThrow("invalid release version");
  });
});
