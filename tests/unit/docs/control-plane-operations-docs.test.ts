import fs from "node:fs";
import { describe, expect, it } from "vitest";

const documentationPath = "docs/operations/control-plane-reconciliation.md";

describe("control-plane operator documentation", () => {
  it("documents the authenticated dead-letter operator contract", () => {
    expect(fs.existsSync(documentationPath)).toBe(true);
    const documentation = fs.existsSync(documentationPath) ? fs.readFileSync(documentationPath, "utf8") : "";
    expect(documentation).toContain("BOARDREADYOPS_OPERATOR_API_TOKEN");
    expect(documentation).toContain("BOARDREADYOPS_OPERATOR_ACTOR_ID");
    expect(documentation).toContain("GET /api/v1/operator/installations/{installationId}/dead-letters");
    expect(documentation).toContain(
      "POST /api/v1/operator/installations/{installationId}/dead-letters/{itemType}/{itemId}/replay",
    );
    expect(documentation).toContain("Idempotency-Key");
    expect(documentation).toContain("private network");
    expect(documentation).toContain("audit event");
    expect(documentation).toContain("github_result_callback_missing");
    expect(documentation).toContain("github_workflow_deadline_exceeded");
    expect(documentation).toContain("short-lived token");
    expect(documentation).toContain("GitHub Check Run publication reconciliation");
    expect(documentation).toContain("github_check_run_update_failed");
    expect(documentation).toContain("lastSuccessfulCheckRunReconciliationAt");
  });

  it("documents lifecycle inbox and job drift reconciliation", () => {
    const deployment = fs.readFileSync("docs/deployment/self-hosted.md", "utf8");
    const operations = fs.readFileSync(documentationPath, "utf8");
    const combined = `${deployment}
${operations}`;

    expect(combined).toContain("lifecycle_job_missing");
    expect(combined).toContain("lifecycle_inbox_state_drift");
    expect(combined).toContain("control_plane_jobs.status");
    expect(combined).toContain("worker.lifecycle_reconciliation_detected");
    expect(combined).toContain("worker.lifecycle_reconciliation_detection_failed");
    expect(combined).toContain("worker.lifecycle_reconciliation_claim_failed");
    expect(combined).toContain("worker.lifecycle_reconciliation_terminal");
    expect(combined).toContain("lastLifecycleReconciliationPollAt");
    expect(combined).toContain("lastSuccessfulLifecycleReconciliationAt");
    expect(combined).toContain("does not require GitHub credentials");
    expect(combined).toContain("normalized actions");
  });

  it("keeps deploy configuration and public navigation synchronized", () => {
    const deploymentEnvironment = fs.readFileSync("deploy/env.example", "utf8");
    expect(deploymentEnvironment).toContain("BOARDREADYOPS_OPERATOR_API_TOKEN=");
    expect(deploymentEnvironment).toContain("BOARDREADYOPS_OPERATOR_ACTOR_ID=");
    expect(deploymentEnvironment).toContain("BOARDREADYOPS_RECONCILIATION_DEADLINE_SECONDS=1800");
    expect(deploymentEnvironment).toContain("BOARDREADYOPS_RECONCILIATION_NEXT_CHECK_SECONDS=60");

    const navigation = fs.readFileSync("mkdocs.yml", "utf8");
    expect(navigation).toContain("Control-plane Reconciliation: operations/control-plane-reconciliation.md");
  });

  it("documents the initial GitHub Cloud GA SLO policy and transition events", () => {
    const deployment = fs.readFileSync("docs/deployment/self-hosted.md", "utf8");
    const operations = fs.readFileSync(documentationPath, "utf8");
    const combined = `${deployment}
${operations}`;

    expect(combined).toContain("github-cloud-ga-v1");
    expect(combined).toContain("worker.control_plane_slo_evaluation");
    expect(combined).toContain("worker.control_plane_slo_firing");
    expect(combined).toContain("worker.control_plane_slo_recovered");
    expect(combined).toContain("worker.control_plane_slo_failed");
    expect(combined).toContain("1,000 ms");
    expect(combined).toContain("60 seconds");
    expect(combined).toContain("500 basis points");
    expect(combined).toContain("at least 20 terminal runs");
    expect(combined).toContain("transition");
    expect(combined).toContain("does not affect worker readiness");
    expect(combined).toContain("worker restart resets");
  });
});
