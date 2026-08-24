import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = join(process.cwd(), ".github/workflows/readiness-runner.yml");

describe("readiness runner workflow security contract", () => {
  it("executes the exact target commit on a GitHub-hosted runner with KiCad", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("runs-on: ubuntu-latest");
    expect(workflow).toContain("ref: $" + "{{ inputs.head_sha }}");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain('actual_sha="$(git rev-parse HEAD)"');
    expect(workflow).toContain("ppa:kicad/kicad-10.0-releases");
    expect(workflow).toContain('require-kicad: "true"');
    expect(workflow).toContain("project: $" + "{{ vars.BOARDREADYOPS_PROJECT || '' }}");
    expect(workflow).toContain("config: $" + "{{ vars.BOARDREADYOPS_CONFIG || 'boardreadyops.yml' }}");
    expect(workflow).toContain("uses: oaslananka/boardreadyops@ce925376bd71daf7e07f31fb1bb19a8bde30b172");
    expect(workflow).toContain("safe-mode: $" + "{{ inputs.safe_mode }}");
    expect(workflow).not.toContain("runner-ready");
  });

  it("pins the setup probe to the current verified release", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("ref: ce925376bd71daf7e07f31fb1bb19a8bde30b172 # v1.24.1");
    expect(workflow).toContain('if [ "$tool_version" != "1.24.1" ]');
  });

  it("uses GitHub OIDC without a shared cloud secret", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("id: validate");
    expect(workflow).toContain("if: always() && steps.validate.outcome == 'success'");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("HEAD_SHA: $" + "{{ inputs.head_sha }}");
    expect(workflow).toContain("const oidcToken = await core.getIDToken(audience)");
    expect(workflow).toContain("authorization: `Bearer $" + "{oidcToken}`");
    expect(workflow).toContain(
      "boardreadyops-cloud:$" +
        "{runId}:$" +
        "{executionAttemptId}:$" +
        "{targetSha}:$" +
        "{trustMode}:$" +
        '{safeModeReasons || "none"}',
    );
    expect(workflow).not.toContain("BRO_RUNNER_KEY");
    expect(workflow).not.toContain("BOARDREADYOPS_RUNNER_RESULT_KEY");
  });

  it("publishes findings, metrics, and the GitHub Actions run link", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain('const reportPath = "boardreadyops.findings.json"');
    expect(workflow).toContain("version: 1");
    expect(workflow).toContain("executionAttemptId");
    expect(workflow).toContain("const reportAvailable =");
    expect(workflow).toContain("const operationalFailure = !reportAvailable");
    expect(workflow).toContain("const findings = rawFindings.slice(0, 500)");
    expect(workflow).toContain('Buffer.byteLength(JSON.stringify(payload), "utf8") > 900 * 1024');
    expect(workflow).toContain("findings_total:");
    expect(workflow).toContain('label: "GitHub Actions run"');
    expect(workflow).toContain('report.hardwareImpact && typeof report.hardwareImpact === "object"');
    expect(workflow).toContain("...(hardwareImpact ? { hardwareImpact } : {})");
    expect(workflow).toContain("for (let attempt = 1; attempt <= 3; attempt += 1)");
    expect(workflow).toContain("core.setFailed(policyFailed");
  });

  it("requires the target repository to configure the control-plane origin explicitly", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("CLOUD_ORIGIN: $" + "{{ vars.BOARDREADYOPS_CLOUD_ORIGIN }}");
    expect(workflow).not.toContain("boardreadyops.oaslananka.dev");
  });

  it("binds dispatch to this repository, the exact SHA, and the production callback", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("run_id must be a lowercase UUID");
    expect(workflow).toContain("execution_attempt_id must be a lowercase UUID");
    expect(workflow).toContain('if [ "$TARGET" != "$GITHUB_REPOSITORY" ]');
    expect(workflow).toContain('[[ "$HEAD_SHA" =~ ^[0-9a-f]{40}$ ]]');
    expect(workflow).toContain(
      'expected_url="$' +
        "{CLOUD_ORIGIN}/api/v1/runs/github-actions-result?run_id=$" +
        "{RUN_ID}&attempt_id=$" +
        '{EXECUTION_ATTEMPT_ID}"',
    );
    expect(workflow).toContain("BOARDREADYOPS_CLOUD_ORIGIN must be an HTTPS origin");
    expect(workflow).toContain('if [ "$RESULT_URL" != "$expected_url" ]');
  });

  it("requires execution-attempt binding and validates safe-mode metadata", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const executionAttemptInput = workflow.slice(
      workflow.indexOf("execution_attempt_id:"),
      workflow.indexOf("target:"),
    );

    expect(executionAttemptInput).toContain("required: true");
    expect(executionAttemptInput).not.toContain('default: ""');
    expect(workflow).toContain("safe_mode must be true or false");
    expect(workflow).toContain("safe_mode_reasons requires safe_mode=true");
    expect(workflow).toContain("safe_mode=true requires at least one reason");
    expect(workflow).toContain("draft-pull-request|fork-pull-request|private-repository");
    expect(workflow).toContain("duplicate safe-mode reason");
    expect(workflow).toContain("SAFE_MODE: $" + "{{ inputs.safe_mode }}");
    expect(workflow).toContain("SAFE_MODE_REASONS: $" + "{{ inputs.safe_mode_reasons }}");
    expect(workflow).toContain('"x-boardreadyops-trust-mode": trustMode');
    expect(workflow).toContain('"x-boardreadyops-safe-mode-reasons": safeModeReasons');
  });

  it("adds only repository-scoped read permissions for exact-base impact and keeps dispatch inputs stable", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const readinessJob = workflow.slice(workflow.indexOf("  readiness:"), workflow.indexOf("  setup-probe:"));
    const actionStep = readinessJob.slice(
      readinessJob.indexOf("- name: Run BoardReadyOps"),
      readinessJob.indexOf("- name: Publish OIDC-authenticated cloud result"),
    );

    expect(workflow).not.toContain("base_sha:");
    expect(readinessJob).toContain(
      [
        "permissions:",
        "      actions: read",
        "      checks: read",
        "      contents: read",
        "      id-token: write",
      ].join("\n"),
    );
    expect(actionStep).toContain("GITHUB_TOKEN: $" + "{{ github.token }}");
    expect(actionStep).toContain("BOARDREADYOPS_PR_HEAD_SHA: $" + "{{ inputs.head_sha }}");
    expect(actionStep).toContain("BOARDREADYOPS_CLOUD_RUN_ID: $" + "{{ inputs.run_id }}");
    expect(workflow).not.toContain("pull-requests: write");
    expect(workflow).not.toContain("contents: write");
    expect(workflow).not.toContain("GITHUB_APP_PRIVATE_KEY");
    expect(workflow).not.toContain("BOARDREADYOPS_RUNNER_RESULT_KEY");
  });
  it("forwards per-board BOM rows within the contract bounds", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("const rawBoms = reportAvailable && Array.isArray(report.boms) ? report.boms : [];");
    expect(workflow).toContain(".slice(0, 50)");
    expect(workflow).toContain(".slice(0, 5000)");
    expect(workflow).toContain("...(boms.length > 0 ? { boms } : {})");
  });

  it("sheds BOM rows before findings when the payload exceeds its transmit budget", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("while (payloadTooLarge() && boms.length > 0)");
    expect(workflow).toContain("while (payloadTooLarge() && findings.length > 0)");
    expect(workflow).toContain("payload.metrics.boms_transmitted = boms.length;");
    expect(workflow).toContain("if (boms.length === 0) delete payload.boms;");
  });

  it("bounds the transmitted component count before measuring the payload", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    // Sizing must not re-serialise the payload once per dropped component: the contract
    // permits 50 boards of 5000 rows, which would stall the callback job for minutes.
    expect(workflow).toContain("let componentBudget = 20000;");
    expect(workflow).toContain("boms.pop();");
    expect(workflow).not.toContain("boms[largest].components.pop()");
  });
});
