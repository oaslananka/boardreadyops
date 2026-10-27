import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyChangedFiles, readFilesFromArg } from "../../../scripts/ci-risk-profile.mjs";

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

  it("runs docs and security gates for the public docs edge worker", () => {
    const profile = classifyChangedFiles(["scripts/docs-agent-edge-worker.mjs"], { eventName: "pull_request" });

    expect(profile.needs_docs).toBe(true);
    expect(profile.needs_accessibility).toBe(true);
    expect(profile.needs_security).toBe(true);
  });

  it("runs docs gates for documentation discovery generator changes", () => {
    const profile = classifyChangedFiles(["scripts/docs-discovery.mjs"], { eventName: "pull_request" });

    expect(profile.needs_docs).toBe(true);
    expect(profile.needs_accessibility).toBe(true);
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

  it("runs NOTICE compliance for dependency inventory and generator changes", () => {
    for (const file of ["package.json", "pnpm-lock.yaml", "scripts/build-notice.mjs"]) {
      const profile = classifyChangedFiles([file], { eventName: "pull_request" });
      expect(profile.needs_security, file).toBe(true);
    }
  });

  it("runs SAST for security configuration changes without treating them as executable code", () => {
    for (const file of ["renovate.json", ".semgrep.yml", ".semgrepignore", ".github/dependabot.yml"]) {
      const profile = classifyChangedFiles([file], { eventName: "pull_request" });

      expect(profile.needs_sast, file).toBe(true);
      expect(profile.needs_security, file).toBe(true);
      expect(profile.code_changed, file).toBe(false);
    }
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

  it("keeps billing/database PRs off KiCad PPA while exercising PostgreSQL integration", () => {
    for (const file of [
      "packages/db/src/billing-store.ts",
      "packages/db/migrations/0096_stripe_reconciliation_claims.sql",
      "packages/db/migrations/0095_pending_stripe_customer_events_index.sql",
      "packages/cloud-core/src/stripe-service.ts",
      "apps/web/lib/stripe-entitlement-worker.ts",
      "apps/web/app/api/v1/billing/webhook/route.ts",
      "tests/integration/stripe-entitlement-reconciliation-postgres.test.ts",
    ]) {
      const profile = classifyChangedFiles([file], { eventName: "pull_request" });
      expect(profile.needs_integration, file).toBe(true);
      expect(profile.needs_kicad, file).toBe(false);
      expect(profile.needs_unit_matrix, file).toBe(false);
    }
  });

  it("fails closed to real KiCad validation for unknown integration and manufacturing changes", () => {
    for (const file of [
      "packages/contracts/src/index.ts",
      "packages/cloud-core/src/lifecycle-executor.ts",
      "tests/integration/runner-artifact-store-postgres.test.ts",
      "packages/db/src/runner-artifact-store.ts",
      "packages/db/src/lifecycle-store.ts",
      "packages/db/migrations/0099_manufacturing_output_control.sql",
      "tests/integration/new-unknown-postgres.test.ts",
      "tests/integration/manufacturing-real-archive.test.ts",
      "tests/fixtures/projects/safe-basic/safe-basic.kicad_pcb",
      "src/rules/manufacturing/fiducials.ts",
      ".github/workflows/ci.yml",
      "pnpm-lock.yaml",
    ]) {
      const profile = classifyChangedFiles([file], { eventName: "pull_request" });
      expect(profile.needs_integration, file).toBe(true);
      expect(profile.needs_kicad, file).toBe(true);
    }
  });

  it("does not exempt mixed billing and manufacturing/database changes", () => {
    const profile = classifyChangedFiles(
      ["packages/db/src/billing-store.ts", "packages/db/src/runner-artifact-store.ts"],
      { eventName: "pull_request" },
    );
    expect(profile.needs_integration).toBe(true);
    expect(profile.needs_kicad).toBe(true);
  });

  it("requires real KiCad integration for workflow-only changes outside ci.yml", () => {
    const profile = classifyChangedFiles([".github/workflows/publish-npm.yml"], {
      eventName: "pull_request",
    });
    expect(profile.workflow_changed).toBe(true);
    expect(profile.needs_integration).toBe(true);
    expect(profile.needs_kicad).toBe(true);
  });

  it("keeps the full real KiCad suite on main pushes and manual workflows", () => {
    for (const eventName of ["push", "workflow_dispatch"]) {
      const profile = classifyChangedFiles(["docs/README.md"], { eventName });
      expect(profile.needs_integration).toBe(true);
      expect(profile.needs_kicad).toBe(true);
    }
    expect(classifyChangedFiles(["docs/README.md"], { eventName: "pull_request" }).needs_kicad).toBe(false);
  });

  it("runs visual snapshots only for UI-facing changes while preserving report accessibility", () => {
    const report = classifyChangedFiles(["src/report/review-comment.ts", "packages/contracts/src/index.ts"], {
      eventName: "pull_request",
    });
    expect(report.needs_accessibility).toBe(true);
    expect(report.needs_coverage).toBe(true);
    expect(report.needs_visual).toBe(false);

    for (const file of ["apps/web/app/page.tsx", "apps/web/components/review-detail.tsx", "tests/e2e/visual.spec.ts"]) {
      expect(classifyChangedFiles([file], { eventName: "pull_request" }).needs_visual, file).toBe(true);
    }
    expect(classifyChangedFiles(["src/report/html-render.ts"], { eventName: "pull_request" }).needs_visual).toBe(true);
    expect(classifyChangedFiles(["docs/readme.md"], { eventName: "push" }).needs_visual).toBe(true);
  });

  it("runs browser and accessibility gates for web UI and e2e changes", () => {
    for (const file of [
      "apps/web/app/setup/page.tsx",
      "apps/web/components/yaml-syntax-highlighter.tsx",
      "tests/e2e/repository-setup-preview.spec.ts",
    ]) {
      expect(classifyChangedFiles([file], { eventName: "pull_request" }).needs_accessibility, file).toBe(true);
    }
  });

  it("runs cloud coverage for changed cloud paths", () => {
    for (const file of [
      "apps/web/lib/cloud-readiness.ts",
      "packages/cloud-core/src/lifecycle.ts",
      "packages/contracts/src/runner-protocol.ts",
      "packages/db/src/lifecycle-store.ts",
      "vitest.cloud.config.ts",
    ]) {
      expect(classifyChangedFiles([file], { eventName: "pull_request" }).needs_coverage, file).toBe(true);
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

  it("marks engine-only changes without triggering an unrelated Windows cloud package build", () => {
    for (const changed of ["src/core/pipeline.ts", "src/kicad/snapshots.ts", "tests/unit/kicad/pcb.test.ts"]) {
      const profile = classifyChangedFiles([changed], { eventName: "pull_request" });
      expect(profile.domain_engine, changed).toBe(true);
      expect(profile.domain_cloud, changed).toBe(false);
      expect(profile.domain_integrations, changed).toBe(false);
      expect(profile.needs_web_standalone, changed).toBe(false);
      expect(profile.needs_unit, changed).toBe(true);
      expect(profile.needs_build, changed).toBe(true);
    }
  });

  it("routes cloud, shared contracts and SQL changes to independent web acceptance", () => {
    for (const changed of [
      "apps/web/lib/remote-mcp-http.ts",
      "packages/db/migrations/0101_hosted_review_findings_pagination_index.sql",
      "packages/contracts/src/review.ts",
      "packages/cloud-core/src/lifecycle-executor.ts",
      "deploy/Caddyfile",
      "tests/integration/remote-mcp-findings-postgres.test.ts",
      "src/report/html-render.ts",
    ]) {
      const profile = classifyChangedFiles([changed], { eventName: "pull_request" });
      expect(profile.domain_cloud, changed).toBe(true);
      expect(profile.needs_web_standalone, changed).toBe(true);
    }
  });

  it("keeps the MCP/SDK integration domain independent of the Windows cloud bundle", () => {
    for (const changed of [
      "packages/mcp-server/src/index.ts",
      "packages/plugin-sdk/src/index.ts",
      "src/runner/client.ts",
    ]) {
      const profile = classifyChangedFiles([changed], { eventName: "pull_request" });
      expect(profile.domain_integrations, changed).toBe(true);
      expect(profile.needs_web_standalone, changed).toBe(false);
    }
  });

  it("conservatively treats shared runtime, workflow and main pushes as affecting every domain", () => {
    for (const changed of [
      "package.json",
      "pnpm-lock.yaml",
      "toolchain.json",
      "tsconfig.json",
      "tsconfig.build.json",
      ".github/workflows/ci.yml",
      ".github/workflows/benchmark.yml",
      "scripts/ci-risk-profile.mjs",
    ]) {
      const profile = classifyChangedFiles([changed], { eventName: "pull_request" });
      expect(profile.domain_engine, changed).toBe(true);
      expect(profile.domain_cloud, changed).toBe(true);
      expect(profile.domain_integrations, changed).toBe(true);
      expect(profile.needs_web_standalone, changed).toBe(true);
      // Security eligibility remains governed by the existing independent risk profile.
      if (
        ["package.json", "pnpm-lock.yaml", ".github/workflows/ci.yml", ".github/workflows/benchmark.yml"].includes(
          changed,
        )
      ) {
        expect(profile.needs_security, changed).toBe(true);
      }
    }
    const main = classifyChangedFiles(["README.md"], { eventName: "push" });
    expect(main.domain_cloud).toBe(true);
    expect(main.needs_web_standalone).toBe(true);
    expect(main.needs_kicad).toBe(true);
    expect(main.needs_coverage).toBe(true);
    expect(main.needs_security).toBe(true);
    const docs = classifyChangedFiles(["README.md"], { eventName: "pull_request" });
    expect(docs.domain_engine).toBe(false);
    expect(docs.domain_cloud).toBe(false);
    expect(docs.domain_integrations).toBe(false);
    expect(docs.needs_web_standalone).toBe(false);
  });

  it("preserves all previously required gates for mixed engine, cloud and integrations changes", () => {
    const p = classifyChangedFiles(
      ["src/rules/manufacturing/fiducials.ts", "apps/web/app/mcp/route.ts", "packages/mcp-server/src/index.ts"],
      { eventName: "pull_request" },
    );
    expect([p.domain_engine, p.domain_cloud, p.domain_integrations]).toEqual([true, true, true]);
    expect(p.needs_web_standalone).toBe(true);
    expect(p.needs_integration).toBe(true);
    expect(p.needs_kicad).toBe(true);
    expect(p.needs_coverage).toBe(true);
    expect(p.needs_typecheck).toBe(true);
  });

  it("keeps required CI checks while targeting native benchmarks to relevant PRs", async () => {
    const ci = await readFile(".github/workflows/ci.yml", "utf8");
    const bench = await readFile(".github/workflows/benchmark.yml", "utf8");
    for (const name of [
      "ci / risk-profile",
      "ci / lint",
      "ci / typecheck",
      "ci / test-unit",
      "ci / unit-matrix-gate",
      "ci / build",
      "ci / verify-dist",
      "ci / coverage-gate",
      "security / gate",
    ]) {
      if (name === "security / gate") continue; // independent security workflow owns this gate
      expect(ci).toContain(`name: ${name}`);
    }
    expect(ci).toContain(`needs_web_standalone: \${{ steps.classify.outputs.needs_web_standalone }}`);
    expect(ci).toContain("needs.risk-profile.outputs.needs_web_standalone == 'true'");
    expect(ci).toContain(
      "needs.risk-profile.outputs.needs_build == 'true' && needs.risk-profile.outputs.needs_web_standalone == 'true'",
    );
    expect(bench).toContain("  pull_request:");
    expect(bench).toContain('      - "tests/benchmark/**"');
    expect(bench).toContain("  push:");
    expect(bench).toContain("      - main");
    expect(bench).toContain("node-version-file: .nvmrc");
    expect(bench).toContain("Benchmark / informational");
    expect(bench).toContain("shell: bash");
    expect(bench).toContain("set -euo pipefail");
    expect(bench).toContain("pnpm run benchmark | tee benchmark.txt");
  });

  it("rejects changed-file list paths that escape the repository root", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-ci-risk-"));
    const repositoryRoot = path.join(parent, "repo");
    const outside = path.join(parent, "outside.txt");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(repositoryRoot));
    await writeFile(outside, "src/core/index.ts\n", "utf8");

    expect(() => readFilesFromArg(outside, repositoryRoot)).toThrow(/outside the repository root/u);
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
