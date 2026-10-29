import fs from "node:fs";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/target-repository-isolation.yml";
const documentationPath = "docs/deployment/github-actions-execution.md";
const targetWorkflowPath = ".github/workflows/readiness-runner.yml";
const serverOidcExpectationsPath = "apps/web/lib/result-oidc-expectations.ts";

describe("target-repository two-installation isolation workflow", () => {
  it("documents the exact OIDC audience shared by the target workflow and server", () => {
    const workflow = fs.readFileSync(targetWorkflowPath, "utf8");
    const serverExpectations = fs.readFileSync(serverOidcExpectationsPath, "utf8");
    const documentation = fs.readFileSync(documentationPath, "utf8");

    expect(workflow).toMatch(
      /boardreadyops-cloud:\$\{runId\}:\$\{executionAttemptId\}:\$\{targetSha\}:\$\{trustMode\}:\$\{safeModeReasons \|\| "none"\}/u,
    );
    expect(serverExpectations).toMatch(
      /boardreadyops-cloud:\$\{runId\}:\$\{executionAttemptId \?\? "none"\}:\$\{sha\}:\$\{trust\.trustMode\}:/u,
    );
    expect(documentation).toContain(
      "boardreadyops-cloud:<run-id>:<attempt-id>:<target-sha>:<trust-mode>:<safe-mode-reasons-or-none>",
    );
    expect(documentation).toContain("the control plane derives and validates the same audience");
    expect(documentation).not.toContain("audience `boardreadyops-cloud:<run-id>:<attempt-id>`");
  });

  it("runs the PostgreSQL adversarial proof with read-only repository permissions and aggregate evidence", () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const documentation = fs.readFileSync(documentationPath, "utf8");
    const packageJson = fs.readFileSync("package.json", "utf8");
    const integrationRunner = fs.readFileSync("scripts/run-monorepo-integration.mjs", "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("postgres:17-alpine");
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
