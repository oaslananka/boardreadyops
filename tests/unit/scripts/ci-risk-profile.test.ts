import { describe, expect, it } from "vitest";
import { classifyChangedFiles } from "../../../scripts/ci-risk-profile.mjs";

describe("ci-risk-profile", () => {
  it("keeps docs-only pull requests on the docs path without heavy runtime gates", () => {
    const profile = classifyChangedFiles(["docs/integrations/kibot.md", "README.md"], {
      eventName: "pull_request",
    });

    expect(profile.docs_only).toBe(true);
    expect(profile.needs_docs).toBe(true);
    expect(profile.needs_unit).toBe(false);
    expect(profile.needs_coverage).toBe(false);
    expect(profile.needs_mutation).toBe(false);
    expect(profile.needs_security).toBe(false);
  });

  it("runs parser and rule quality gates for manufacturing rule changes", () => {
    const profile = classifyChangedFiles(["src/rules/manufacturing/fiducials.ts"], {
      eventName: "pull_request",
    });

    expect(profile.docs_only).toBe(false);
    expect(profile.needs_unit).toBe(true);
    expect(profile.needs_coverage).toBe(true);
    expect(profile.needs_mutation).toBe(true);
    expect(profile.needs_build).toBe(true);
  });

  it("runs package and action gates for dist or action changes", () => {
    const profile = classifyChangedFiles(["action.yml", "dist/action/index.cjs"], {
      eventName: "pull_request",
    });

    expect(profile.needs_action_smoke).toBe(true);
    expect(profile.needs_dist).toBe(true);
    expect(profile.needs_security).toBe(true);
  });

  it("runs the coverage gate for report-only changes since the report is measured", () => {
    const profile = classifyChangedFiles(["src/report/html-render.ts"], { eventName: "pull_request" });

    expect(profile.docs_only).toBe(false);
    expect(profile.needs_coverage).toBe(true);
    // report is not in the mutation scope, so mutation stays skipped
    expect(profile.needs_mutation).toBe(false);
  });

  it("runs integration gates for cloud persistence, web callbacks, and integration tests", () => {
    for (const file of [
      "packages/db/migrations/0006_release_run_results.sql",
      "packages/contracts/src/index.ts",
      "packages/cloud-core/src/lifecycle-executor.ts",
      "apps/web/app/api/v1/runs/result/route.ts",
      "tests/integration/runner-result-postgres.test.ts",
      ".github/workflows/ci.yml",
    ]) {
      const profile = classifyChangedFiles([file], { eventName: "pull_request" });
      expect(profile.needs_integration, file).toBe(true);
    }
  });

  it("runs the coverage gate when only tests change", () => {
    const profile = classifyChangedFiles(["tests/unit/report/html.test.ts"], { eventName: "pull_request" });
    expect(profile.needs_coverage).toBe(true);
  });

  it("does not run coverage or mutation for release-only changes outside the measured set", () => {
    const profile = classifyChangedFiles(["src/release/diff.ts"], { eventName: "pull_request" });

    expect(profile.needs_unit).toBe(true);
    expect(profile.needs_coverage).toBe(false);
    expect(profile.needs_mutation).toBe(false);
  });

  it("treats main pushes as full runs regardless of path", () => {
    const profile = classifyChangedFiles(["docs/README.md"], { eventName: "push" });

    expect(profile.full_run).toBe(true);
    expect(profile.docs_only).toBe(false);
    expect(profile.needs_unit_matrix).toBe(true);
    expect(profile.needs_mutation).toBe(true);
    expect(profile.needs_security).toBe(true);
  });
});
