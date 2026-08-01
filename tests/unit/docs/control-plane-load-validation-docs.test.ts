import fs from "node:fs";
import { describe, expect, it } from "vitest";

const documentationPath = "docs/operations/control-plane-load-validation.md";
const workflowPath = ".github/workflows/control-plane-load.yml";

describe("control-plane load validation documentation", () => {
  it("documents the isolated scenario, thresholds, evidence, and remaining GA boundaries", () => {
    expect(fs.existsSync(documentationPath)).toBe(true);
    expect(fs.existsSync(workflowPath)).toBe(true);

    const documentation = fs.readFileSync(documentationPath, "utf8");
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const navigation = fs.readFileSync("mkdocs.yml", "utf8");
    const packageJson = fs.readFileSync("package.json", "utf8");

    expect(documentation).toContain("isolated, disposable database");
    expect(documentation).toContain("BOARDREADYOPS_LOAD_CONFIRMATION=isolated-disposable-database");
    expect(documentation).toContain("pnpm run cloud:load:verify");
    expect(documentation).toContain("zero cross-tenant mismatches");
    expect(documentation).toContain("Intake p95 limit");
    expect(documentation).toContain("1,500 ms");
    expect(documentation).toContain("10 operations/second");
    expect(documentation).toContain("mode `0600`");
    expect(documentation).toContain("does not by itself satisfy sustained soak");
    expect(documentation).toContain("issue #222");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("postgres:16-alpine");
    expect(workflow).toContain("POSTGRES_HOST_AUTH_METHOD: trust");
    expect(workflow).toContain("pnpm install --frozen-lockfile --ignore-scripts");
    expect(workflow).toContain("BOARDREADYOPS_LOAD_REPORT_PATH: control-plane-load-report.json");
    expect(workflow).toContain("retention-days: 30");
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toContain("secrets.");

    expect(navigation).toContain("Control-plane Load Validation: operations/control-plane-load-validation.md");
    expect(packageJson).toContain('"cloud:load:verify": "node scripts/control-plane-load.mjs"');
  });
});
