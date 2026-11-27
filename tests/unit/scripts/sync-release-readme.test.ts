import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  IMMUTABLE_ACTION_PIN_PATHS,
  PUBLIC_RELEASE_PATHS,
  syncPublicReleaseFiles,
  syncReleaseReadme,
  verifyPublicReleaseFiles,
} from "../../../scripts/sync-release-readme.mjs";

const FILES = [
  ...new Set([...PUBLIC_RELEASE_PATHS, ...IMMUTABLE_ACTION_PIN_PATHS, ".github/ISSUE_TEMPLATE/bug_report.yml"]),
];
const sourceFiles = Object.fromEntries(FILES.map((file) => [file, readFileSync(join(process.cwd(), file), "utf8")]));

describe("sync-release-readme", () => {
  it("distinguishes an unpublished source candidate from public releases across every generated surface", () => {
    const candidate = syncPublicReleaseFiles(sourceFiles, "1.69.0");

    expect(candidate["README.md"]).toContain("Repository-prepared version:** `boardreadyops@1.69.0`");
    expect(candidate["README.md"]).toContain("not evidence that it has been published");
    expect(candidate["docs/install.md"]).toContain("Repository-prepared version:** `boardreadyops@1.69.0`");
    expect(candidate["docs/install.md"]).toContain("npx -y boardreadyops@latest --help");
    expect(candidate["docs/install.md"]).toContain("may lag");
    expect(candidate["docs/action.md"]).toContain(
      "the version prepared in a release pull request may not be available yet",
    );
    expect(candidate["docs/security/release-integrity.md"]).toContain("/releases/latest/download/SHA256SUMS");
    expect(candidate["docs/security/release-integrity.md"]).not.toContain("/releases/download/v1.69.0/SHA256SUMS");
    expect(candidate["docs/repo-maturity-report.md"]).toContain(
      "a prepared source version is not publication evidence",
    );
    expect(candidate["docs/release/channel-verification.md"]).toContain("Source candidate:** `boardreadyops@1.69.0`");
    expect(candidate["docs/release/channel-verification.md"]).toContain("not necessarily published");
    expect(candidate["docs/release/channel-verification.md"]).not.toContain(
      "latest public release is `boardreadyops@1.69.0`",
    );
    expect(candidate["docs/release/reference-synchronization.md"]).toContain(
      "package version is `boardreadyops@1.69.0`; it may not be published",
    );
    expect(candidate["docs/release/copy-paste-audit.md"]).toContain(
      "package version is `boardreadyops@1.69.0`; it may not be published",
    );
    expect(() => verifyPublicReleaseFiles(candidate, "1.69.0")).not.toThrow();
  });

  it("documents immutable historical Git tags separately from moving GHCR image aliases", () => {
    const candidate = syncPublicReleaseFiles(sourceFiles, "1.69.0");
    expect(candidate["README.md"]).toContain("Historical shortened Git tags such as `v1` are immutable");
    expect(candidate["docs/action.md"]).toContain("Historical shortened Git tags such as `v1` are immutable");
    expect(candidate["docs/release/channel-verification.md"]).toContain(
      "historical Git tags such as `v1` are immutable",
    );
    expect(candidate["docs/release/channel-verification.md"]).toContain(
      "Confirm actual published `v1`/`latest` digests independently",
    );
  });

  it("rejects a stale quickstart Action pin, not just the main README pin", () => {
    expect(IMMUTABLE_ACTION_PIN_PATHS).toContain("docs/quickstart.md");
    const candidate = syncPublicReleaseFiles(sourceFiles, "1.69.0");
    const quickstart = candidate["docs/quickstart.md"];
    if (quickstart === undefined) throw new Error("Quickstart source is missing");
    const stale = {
      ...candidate,
      "docs/quickstart.md": quickstart.replace(
        /oaslananka\/boardreadyops@[0-9a-f]{40}\s+#\s+v[\d.]+/u,
        "oaslananka/boardreadyops@1111111111111111111111111111111111111111 # v1.4.6",
      ),
    };
    expect(() => verifyPublicReleaseFiles(stale, "1.69.0")).toThrow(/immutable Action pin drift/u);
  });

  it("actually rejects stale public surface files through the direct CLI", () => {
    const root = mkdtempSync(join(tmpdir(), "boardreadyops-release-surface-"));
    try {
      const candidate = syncPublicReleaseFiles(sourceFiles, "1.69.0");
      for (const [file, content] of Object.entries(candidate)) {
        const target = join(root, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(
          target,
          file === "README.md" ? content.replace("boardreadyops@1.69.0", "boardreadyops@0.0.0") : content,
        );
      }
      writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.69.0" }));
      const result = spawnSync(process.execPath, [resolve("scripts/sync-release-readme.mjs"), "--check"], {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(result.status, result.error?.message ?? result.stderr).toBe(1);
      expect(result.stderr).toContain("public release reference drift");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retains historical evidence and immutable Action SHA pins during candidate generation", () => {
    const candidate = syncPublicReleaseFiles(sourceFiles, "1.69.0");
    for (const file of ["docs/release/reference-synchronization.md", "docs/release/copy-paste-audit.md"]) {
      expect(candidate[file]?.split("## Audit Target")[1]).toBe(sourceFiles[file]?.split("## Audit Target")[1]);
    }
    const file = "docs/release/channel-verification.md";
    expect(candidate[file]?.split("## Verified Public Snapshot")[1]).toBe(
      sourceFiles[file]?.split("## Verified Public Snapshot")[1],
    );
    for (const file of IMMUTABLE_ACTION_PIN_PATHS) {
      const matcher = /oaslananka\/boardreadyops(?:\/apps\/container)?@[0-9a-f]{40}\s+#\s+v[\d.]+/gu;
      expect(candidate[file]?.match(matcher)).toEqual(sourceFiles[file]?.match(matcher));
    }
    expect(candidate[".github/ISSUE_TEMPLATE/bug_report.yml"]).toBe(
      sourceFiles[".github/ISSUE_TEMPLATE/bug_report.yml"],
    );
  });

  it("is idempotent for source candidates before and after public publication", () => {
    for (const version of ["1.68.3", "1.69.0", "1.69.1-rc.1"]) {
      const first = syncPublicReleaseFiles(sourceFiles, version);
      expect(syncPublicReleaseFiles(first, version)).toEqual(first);
      expect(() => verifyPublicReleaseFiles(first, version)).not.toThrow();
    }
  });

  it("rejects drift and malformed versions rather than inferring public releases", () => {
    for (const version of ["1.68.3", "1.69.0", "1.69.1-rc.1"]) {
      const candidate = syncPublicReleaseFiles(sourceFiles, version);
      const original = candidate["README.md"] ?? "";
      expect(original).toContain(`boardreadyops@${version}`);
      const stale = {
        ...candidate,
        "README.md": original.replace(`boardreadyops@${version}`, "boardreadyops@0.0.0"),
      };
      expect(() => verifyPublicReleaseFiles(stale, version)).toThrow(
        /public release reference drift.*release:readme/su,
      );
    }
    expect(() => syncReleaseReadme(sourceFiles["README.md"] ?? "", "latest")).toThrow(/invalid release version/u);
    expect(() => syncPublicReleaseFiles(sourceFiles, "latest")).toThrow(/invalid release version/u);
    expect(() => syncReleaseReadme("# Missing marker\n\n## Runtime Support", "1.69.0")).toThrow(
      /repository-prepared version/u,
    );
  });

  it("fails when immutable SHA references are inconsistent or bug templates hardcode releases", () => {
    const candidate = syncPublicReleaseFiles(sourceFiles, "1.69.0");
    const stale = {
      ...candidate,
      "docs/sbom.md": "- uses: oaslananka/boardreadyops@1111111111111111111111111111111111111111 # v1.4.6\n",
      ".github/ISSUE_TEMPLATE/bug_report.yml": "placeholder: 1.7.2\n",
    };
    expect(() => verifyPublicReleaseFiles(stale, "1.69.0")).toThrow(/immutable Action pin drift|version-neutral/u);
  });
});
