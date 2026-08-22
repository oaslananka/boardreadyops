import fs from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
    expect(deployment).toContain("BOARDREADYOPS_EPHEMERAL_RECORD_RETENTION_DAYS");
    expect(deploymentEnvironment).toContain("BOARDREADYOPS_EPHEMERAL_RECORD_RETENTION_DAYS=30");
  });

  it("documents bounded expiry cleanup for runner request nonce digests", () => {
    const deployment = fs.readFileSync("docs/deployment/self-hosted.md", "utf8");
    const deploymentEnvironment = fs.readFileSync("deploy/env.example", "utf8");

    expect(deployment).toContain("expired runner request nonce digests");
    expect(deployment).toContain("BOARDREADYOPS_RETENTION_CLEANUP_BATCH_SIZE");
    expect(deployment).toContain("1 through 10000 rows");
    expect(deployment).toContain("does not remove active nonce replay protection");
    expect(deployment).toContain("Pending artifact upload capabilities become `expired`");
    expect(deployment).toContain("unconsumed runner enrollment tokens become revoked");
    expect(deployment).toContain("pending or dispatched repository setup probes become `expired`");
    expect(deployment).toContain("Active uploads and in-flight probes are not deleted");
    expect(deployment).toContain("terminal artifact capability rows");
    expect(deployment).toContain("consumed or revoked enrollment rows");
    expect(deploymentEnvironment).toContain("BOARDREADYOPS_RETENTION_CLEANUP_BATCH_SIZE=1000");
  });

  it("documents bounded completed control-plane history retention", () => {
    const deployment = fs.readFileSync("docs/deployment/self-hosted.md", "utf8");
    const deploymentEnvironment = fs.readFileSync("deploy/env.example", "utf8");

    expect(deployment).toContain("BOARDREADYOPS_CONTROL_PLANE_HISTORY_RETENTION_DAYS");
    expect(deployment).toContain("defaults to 90 days");
    expect(deployment).toContain("completed outbox effects");
    expect(deployment).toContain("completed reconciliation items");
    expect(deployment).toContain("dead-letter and reconciliation-required records");
    expect(deployment).toContain("retained reconciliation references");
    expect(deploymentEnvironment).toContain("BOARDREADYOPS_CONTROL_PLANE_HISTORY_RETENTION_DAYS=90");
  });

  it("documents bounded artifact upload capability expiry", () => {
    const deployment = fs.readFileSync("docs/deployment/self-hosted.md", "utf8");
    const deploymentEnvironment = fs.readFileSync("deploy/env.example", "utf8");

    expect(deployment).toContain("BOARDREADYOPS_ARTIFACT_CAPABILITY_TTL_SECONDS");
    expect(deployment).toContain("BOARDREADYOPS_SELF_HOSTED_RUNNER_MIN_VERSION");
    expect(deployment).toContain("defaults to 900 seconds");
    expect(deployment).toContain("60 through 3600 seconds");
    expect(deployment).toContain("does not rewrite persisted `expires_at` deadlines");
    expect(deployment).toContain("already issued capabilities");
    expect(deployment).toContain("artifactCapabilityTtlSeconds");
    expect(deploymentEnvironment).toContain("BOARDREADYOPS_ARTIFACT_CAPABILITY_TTL_SECONDS=900");
    expect(deploymentEnvironment).toContain("BOARDREADYOPS_SELF_HOSTED_RUNNER_MIN_VERSION=1.26.1");
  });

  it("documents immutable safe-mode binding for runner claims", () => {
    const safeMode = fs.readFileSync("docs/security/private-repository-safe-mode.md", "utf8");

    expect(safeMode).toContain("Runner claims use the persisted release-run trust snapshot");
    expect(safeMode).toContain(
      "Draft and fork snapshots are excluded before any execution attempt or lease is created",
    );
    expect(safeMode).toContain("runner.lease.claimed");
    expect(safeMode).toContain("does not request artifact upload capabilities or upload generated files");
    expect(safeMode).toContain("publishing an empty artifact list");
    expect(safeMode).toContain("runner.artifacts.suppressed");
    expect(safeMode).toContain("cryptographically binds the dispatch trust mode");
    expect(safeMode).toContain("exactly match the persisted immutable trust snapshot");
    expect(safeMode).toContain("Missing, changed, duplicated, or reordered trust metadata fails closed");
    expect(safeMode).toContain(
      "Queued and terminal GitHub Check Runs, plus readiness comments, show the persisted trust mode",
    );
    expect(safeMode).toContain("managed evidence artifacts were unavailable for that execution");
    expect(safeMode).toContain(
      "self-hosted runner telemetry separately proves artifact suppression and forced workspace cleanup",
    );
    expect(safeMode).toContain("no runner, managed artifact, or result-callback authority was granted");
  });

  it("documents durable physical deletion for replaced managed artifacts", () => {
    const deployment = fs.readFileSync("docs/deployment/self-hosted.md", "utf8");
    const deploymentEnvironment = fs.readFileSync("deploy/env.example", "utf8");

    expect(deployment).toContain("tenant-scoped durable physical-deletion job");
    expect(deployment).toContain("not reused by the accepted replacement");
    expect(deployment).toContain("artifact.object.deletion_skipped");
    expect(deployment).toContain("already-missing file as idempotent success");
    expect(deployment).toContain("dead-letters unsupported drivers or unsafe paths");
    expect(deployment).toContain("never storage paths");
    expect(deployment).toContain("artifacts replaced by a newer accepted result");
    expect(deploymentEnvironment).toContain("BOARDREADYOPS_ARTIFACT_DELETION_CONCURRENCY=2");
    expect(deploymentEnvironment).toContain("BOARDREADYOPS_ARTIFACT_DELETION_POLL_MS=1000");
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
  it("documents isolated PostgreSQL backup verification and recovery objectives", () => {
    const deployment = fs.readFileSync("docs/deployment/self-hosted.md", "utf8");

    expect(deployment).toContain("PostgreSQL backup verification and restore drill");
    expect(deployment).toContain("15-minute recovery point objective");
    expect(deployment).toContain("60-minute recovery time objective");
    expect(deployment).toContain("BOARDREADYOPS_BACKUP_SOURCE_DATABASE_URL");
    expect(deployment).toContain("BOARDREADYOPS_BACKUP_RESTORE_DATABASE_URL");
    expect(deployment).toContain("BOARDREADYOPS_BACKUP_RESTORE_CONFIRMATION=isolated-empty-database");
    expect(deployment).toContain("pnpm run cloud:backup:verify");
    expect(deployment).toContain("must be empty");
    expect(deployment).toContain("Passwords are passed through PostgreSQL client environment variables");
    expect(deployment).toContain("mode `0600`");
    expect(deployment).toContain("without inheriting unrelated service secrets");
    expect(deployment).toContain("representative row counts");
    expect(deployment).toContain("/api/health/ready");
    expect(deployment).toContain("does not verify optional managed artifact bytes");
    expect(deployment).toContain("Artifact metadata follows the PostgreSQL recovery objective");
    expect(deployment).toContain("no BoardReadyOps-managed artifact-byte RPO or RTO applies");
    expect(deployment).toContain("same 15-minute artifact-byte RPO");
    expect(deployment).toContain("inside the same 60-minute service RTO");
    expect(deployment).toContain("Non-local artifact storage drivers are not currently supported");
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

  it("does not encode a retired production host or IP in deployment contracts", () => {
    const files = [
      "docs/deployment/self-hosted.md",
      "docs/deployment/github-actions-execution.md",
      "deploy/env.example",
      "deploy/Caddyfile",
      "deploy/docker-compose.yml",
      "scripts/deploy-cloud.mjs",
      ".github/workflows/readiness-runner.yml",
      ".github/workflows/synthetic-target-repository-canary.yml",
      "scripts/synthetic-target-repository-canary.mjs",
    ];
    const combined = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");

    expect(combined).not.toContain("ops-vps-02");
    expect(combined).not.toContain("46.101.195.208");
    expect(combined).not.toContain("boardreadyops.oaslananka.dev");
    expect(fs.readFileSync("docs/deployment/self-hosted.md", "utf8")).toContain("operator-selected HTTPS origin");
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
      "oaslananka/boardreadyops/.github/workflows/synthetic-target-repository-canary.yml@d93cff3819ffcbbff97ac9600f71a27844c4d005",
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

  it("documents exact-base impact without broadening the GitHub App permission boundary", async () => {
    const deployment = await readFile(join(process.cwd(), "docs/deployment/github-actions-execution.md"), "utf8");
    const review = await readFile(join(process.cwd(), "docs/review-app.md"), "utf8");

    for (const permission of ["actions: read", "checks: read", "contents: read", "id-token: write"]) {
      expect(deployment).toContain(permission);
    }
    expect(deployment).toContain("does **not** alter the production GitHub App permission profile");
    expect(deployment).toContain("does not fall back to another run");
    expect(review).toContain("exact base SHA");
    expect(review).toContain("does not substitute a newer, older, or merely same-branch run");
    expect(review).toContain("current-run decision remains valid");
  });
});
