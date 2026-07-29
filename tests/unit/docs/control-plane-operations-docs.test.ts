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

  it("documents configurable terminal webhook retention without changing existing deadlines", () => {
    const deployment = fs.readFileSync("docs/deployment/self-hosted.md", "utf8");
    const deploymentEnvironment = fs.readFileSync("deploy/env.example", "utf8");

    expect(deployment).toContain("BOARDREADYOPS_WEBHOOK_RETENTION_DAYS");
    expect(deployment).toContain("1 through 3650 days");
    expect(deployment).toContain("newly accepted webhook inbox rows");
    expect(deployment).toContain("does not rewrite existing `retention_until` deadlines");
    expect(deployment).toContain("processed, failed, or dead-letter");
    expect(deployment).toContain("in-flight rows are never purged");
    expect(deploymentEnvironment).toContain("BOARDREADYOPS_WEBHOOK_RETENTION_DAYS=30");
  });

  it("documents bounded artifact upload capability expiry", () => {
    const deployment = fs.readFileSync("docs/deployment/self-hosted.md", "utf8");
    const deploymentEnvironment = fs.readFileSync("deploy/env.example", "utf8");

    expect(deployment).toContain("BOARDREADYOPS_ARTIFACT_CAPABILITY_TTL_SECONDS");
    expect(deployment).toContain("defaults to 900 seconds");
    expect(deployment).toContain("60 through 3600 seconds");
    expect(deployment).toContain("does not rewrite persisted `expires_at` deadlines");
    expect(deployment).toContain("already issued capabilities");
    expect(deployment).toContain("artifactCapabilityTtlSeconds");
    expect(deploymentEnvironment).toContain("BOARDREADYOPS_ARTIFACT_CAPABILITY_TTL_SECONDS=900");
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
  it("documents guarded runner lease lifecycle transitions", () => {
    const lifecycle = fs.readFileSync("docs/product/run-lifecycle.md", "utf8");

    expect(lifecycle).toContain("Schema version 29");
    expect(lifecycle).toContain("runner_lease_claimed");
    expect(lifecycle).toContain("runner_lease_heartbeat");
    expect(lifecycle).toContain("runner_lease_relinquished");
    expect(lifecycle).toContain("runner_lease_expired");
    expect(lifecycle).toContain("current execution-attempt pointer");
    expect(lifecycle).toContain("produces no version increment or transition event");
    expect(lifecycle).toContain("cannot change the newer logical-run or attempt lifecycle state");
    expect(lifecycle).toContain("metadata-only lifecycle store");
    expect(lifecycle).toContain("Lifecycle transitions");
    expect(lifecycle).toContain("at most 100");
    expect(lifecycle).toContain("verify:transition-writers");
    expect(lifecycle).not.toContain("Issue #23 remains open");
  });

  it("documents public and private synthetic target-repository canaries", () => {
    const canaryPath = "docs/operations/synthetic-target-repository-canaries.md";
    expect(fs.existsSync(canaryPath)).toBe(true);
    const canaries = fs.existsSync(canaryPath) ? fs.readFileSync(canaryPath, "utf8") : "";
    const execution = fs.readFileSync("docs/deployment/github-actions-execution.md", "utf8");
    const reconciliation = fs.readFileSync(documentationPath, "utf8");
    const navigation = fs.readFileSync("mkdocs.yml", "utf8");

    expect(canaries).toContain("oaslananka-dev/boardreadyops-canary-public");
    expect(canaries).toContain("oaslananka-dev/boardreadyops-canary-private");
    expect(canaries).toContain("17 */6 * * *");
    expect(canaries).toContain("47 */6 * * *");
    expect(canaries).toContain("workflow_dispatch:");
    expect(canaries).toContain(
      "oaslananka/boardreadyops/.github/workflows/synthetic-target-repository-canary.yml@40788612c2a84d185f7d3f087c0d2a525295ad87",
    );
    expect(canaries).toContain("actions: read");
    expect(canaries).toContain("checks: read");
    expect(canaries).toContain("contents: write");
    expect(canaries).toContain("pull-requests: write");
    expect(canaries).toContain("no long-lived personal access token");
    expect(canaries).toContain("no new GitHub App permission");
    expect(canaries).toContain("verify the live App registration");
    expect(canaries).toContain("Do not install the App");
    expect(canaries).toContain("No organization or account permissions");
    expect(canaries).toContain("#88");
    expect(canaries).toContain("approval-required state");
    expect(canaries).toContain("does not depend on those ordinary pull request workflows");
    expect(canaries).toContain("exact nonce SHA");
    expect(canaries).toContain("workflow_dispatch");
    expect(canaries).toContain("GitHub status");
    expect(canaries).toContain("/health/ready");
    expect(canaries).toContain("worker.control_plane_slo_evaluation");
    expect(canaries).toContain("worker.reconciliation_terminal");
    for (const reason of [
      "canary_pr_update_failed",
      "canary_check_run_missing",
      "canary_check_run_timeout",
      "canary_check_run_failed",
      "canary_check_run_binding_invalid",
      "canary_workflow_missing",
      "canary_workflow_timeout",
      "canary_workflow_failed",
      "canary_github_api_unavailable",
    ]) {
      expect(canaries).toContain(reason);
    }
    expect(navigation).toContain("Synthetic Target Canaries: operations/synthetic-target-repository-canaries.md");
    expect(execution).toContain("synthetic-target-repository-canaries.md");
    expect(reconciliation).toContain("synthetic-target-repository-canaries.md");
  });
});
