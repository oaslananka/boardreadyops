import { readFile } from "node:fs/promises";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { buildCloudCoverageArguments } from "../../../scripts/run-cloud-codecov-coverage.mjs";
import { buildCodecovBundleOptions } from "../../../scripts/run-codecov-bundle-analysis.mjs";
import { buildCodecovCoverageArguments } from "../../../scripts/run-codecov-coverage.mjs";

async function text(path: string): Promise<string> {
  return await readFile(path, "utf8");
}

describe("Codecov integration", () => {
  it("selects GitHub annotations only inside GitHub Actions", () => {
    const local = buildCodecovCoverageArguments({ githubActions: false });
    const github = buildCodecovCoverageArguments({ githubActions: true });

    expect(local).toContain("--reporter=junit");
    expect(local).not.toContain("--reporter=github-actions");
    expect(github).toContain("--reporter=github-actions");
    expect(github).toContain("--outputFile.junit=coverage/test-results.junit.xml");
    expect(buildCloudCoverageArguments({ githubActions: true })).toContain(
      "--outputFile.junit=coverage/cloud/test-results.junit.xml",
    );
  });

  it("uses a bundle token only when one is available", () => {
    const tokenless = buildCodecovBundleOptions({});
    const authenticated = buildCodecovBundleOptions({ uploadToken: "secret-token" });

    expect(tokenless.coreOptions).not.toHaveProperty("uploadToken");
    expect(authenticated.coreOptions).toMatchObject({ uploadToken: "secret-token" });
  });

  it("generates and uploads LCOV plus JUnit results from one coverage run", async () => {
    const packageJson = JSON.parse(await text("package.json")) as { scripts?: Record<string, string> };
    const workflow = await text(".github/workflows/ci.yml");
    const coverageCi = packageJson.scripts?.["coverage:ci"] ?? "";

    expect(coverageCi).toBe("corepack pnpm run coverage:all");
    expect(workflow).toContain("run: pnpm run coverage:ci");
    expect(workflow.match(/codecov\/codecov-action@fb8b3582c8e4def4969c97caa2f19720cb33a72f/gu)).toHaveLength(4);
    expect(workflow).toContain("report_type: test_results");
    expect(workflow).toContain("files: coverage/test-results.junit.xml");
    expect(workflow).toContain("files: coverage/cloud/lcov.info");
    expect(workflow).toContain("files: coverage/cloud/test-results.junit.xml");
    expect(workflow).toContain("flags: core");
    expect(workflow).toContain("flags: cloud");
    expect(workflow.match(/if: \$\{\{ !cancelled\(\) \}\}/gu)?.length).toBeGreaterThanOrEqual(2);
  });

  it("defines components and advisory bundle analysis without an unused integration flag", async () => {
    const config = load(await text("codecov.yml")) as Record<string, unknown>;
    const serialized = JSON.stringify(config);

    expect(serialized).toContain("component_management");
    expect(serialized).toContain("core_engine");
    expect(serialized).toContain("reporting_notifications");
    expect(serialized).toContain("bundle_analysis");
    expect(serialized).toContain("informational");
    expect(serialized).toContain('"cloud"');
    expect(serialized).not.toContain('"integration"');
  });

  it("analyzes the production client bundle without a Next.js peer dependency", async () => {
    const packageJson = JSON.parse(await text("package.json")) as {
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const webPackageJson = JSON.parse(await text("apps/web/package.json")) as {
      devDependencies?: Record<string, string>;
    };
    const nextConfig = await text("apps/web/next.config.mjs");
    const workflow = await text(".github/workflows/ci.yml");
    const bundleRunner = await text("scripts/run-codecov-bundle-analysis.mjs");
    const bundleConfig = JSON.parse(await text("codecov-bundle.json")) as Record<string, unknown>;

    expect(packageJson.devDependencies?.["@codecov/bundle-analyzer"]).toBe("2.0.1");
    expect(packageJson.scripts?.["codecov:bundle"]).toBe("node scripts/run-codecov-bundle-analysis.mjs");
    expect(bundleRunner).toContain('"apps/web/.next/static"');
    expect(bundleRunner).toContain('bundleName: "boardreadyops-web"');
    expect(workflow).toContain("run: pnpm run codecov:bundle");
    expect(workflow).toContain("continue-on-error: true");
    expect(bundleConfig).toMatchObject({ gitService: "github", telemetry: false });
    expect(webPackageJson.devDependencies).not.toHaveProperty("@codecov/nextjs-webpack-plugin");
    expect(nextConfig).not.toContain("@codecov/nextjs-webpack-plugin");
  });
});
