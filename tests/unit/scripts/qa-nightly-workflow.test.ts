import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { visualRoutes } from "../../../qa/audit/routes.js";

const workflowPath = ".github/workflows/qa-nightly.yml";

type Workflow = {
  jobs?: {
    "full-audit"?: {
      steps?: Array<{ name?: string; run?: string; env?: Record<string, string> }>;
    };
  };
};

describe("QA nightly workflow", () => {
  it("enables cross-browser project registration only for the browser-matrix audit step", async () => {
    const workflow = load(await readFile(workflowPath, "utf8")) as Workflow;
    const steps = workflow.jobs?.["full-audit"]?.steps ?? [];
    const routeAudit = steps.find((step) => step.name === "Full route audit (all viewports)");
    const regressionSuite = steps.find((step) => step.name === "Modal / tabs contracts + regression suite");

    expect(routeAudit?.env?.QA_CROSS_BROWSER).toBe("1");
    expect(regressionSuite?.env?.QA_CROSS_BROWSER).toBeUndefined();
  });

  it("keeps the PR smoke audit honest without a fake database", async () => {
    const ci = load(await readFile(".github/workflows/ci.yml", "utf8")) as {
      jobs?: {
        "qa-e2e"?: { steps?: Array<{ name?: string; env?: Record<string, string> }> };
      };
    };
    const smoke = ci.jobs?.["qa-e2e"]?.steps?.find(
      (step) => step.name === "QA smoke suite (Chromium, critical routes)",
    );
    const auditSource = await readFile("tests/e2e/qa-audit.spec.ts", "utf8");

    expect(smoke?.env?.DATABASE_URL).toBe("");
    expect(auditSource).toContain('test("no P0 findings across the full audit @smoke"');
  });

  it("keeps global setup browser-independent and signed in by default", async () => {
    const source = await readFile("tests/e2e/global-setup.ts", "utf8");

    expect(source).not.toContain("import { chromium");
    expect(source).toContain("qa-agent-local-session-secret-not-for-production!");
    expect(source).toContain("writeFile");
  });

  it("ships Linux Chromium baselines for every nightly visual route", () => {
    for (const routeId of visualRoutes) {
      expect(
        existsSync(`tests/e2e/visual.spec.ts-snapshots/${routeId}-chromium-linux.png`),
        `missing Linux visual baseline for ${routeId}`,
      ).toBe(true);
    }
  });
});
