import fs from "node:fs";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/target-repository-isolation.yml";
const documentationPath = "docs/deployment/github-actions-execution.md";

describe("target-repository two-installation isolation workflow", () => {
  it("runs the PostgreSQL adversarial proof with read-only repository permissions and aggregate evidence", () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const documentation = fs.readFileSync(documentationPath, "utf8");
    const packageJson = fs.readFileSync("package.json", "utf8");
    const integrationRunner = fs.readFileSync("scripts/run-monorepo-integration.mjs", "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("postgres:16-alpine");
    expect(workflow).toContain("POSTGRES_HOST_AUTH_METHOD: trust");
    expect(workflow).toContain('BOARDREADYOPS_POSTGRES_TESTS: "true"');
    expect(workflow).toContain("BOARDREADYOPS_ISOLATION_EVIDENCE_PATH");
    expect(workflow).toContain("BOARDREADYOPS_ISOLATION_REPORT_PATH");
    expect(workflow).toContain("pnpm install --frozen-lockfile --ignore-scripts");
    expect(workflow).toContain("pnpm run cloud:isolation:verify");
    expect(workflow).toContain("target-repository-isolation-report.json");
    expect(workflow).toContain("retention-days: 30");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).not.toContain("secrets.");

    expect(packageJson).toContain('"cloud:isolation:verify"');
    expect(integrationRunner).toContain("tests/integration/github-actions-result-isolation-postgres.test.ts");

    for (const phrase of [
      "Two-installation adversarial validation",
      "ADR-0010",
      "Cloud Control Plane Reliability",
      "exact commit SHA",
      "cross-installation",
      "optional pull request comment",
      "aggregate-only",
      "issue #88",
    ]) {
      expect(documentation).toContain(phrase);
    }
  });
});
